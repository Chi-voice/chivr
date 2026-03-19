import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { RecordingModal } from '@/components/RecordingModal';
import {
  ArrowLeft,
  Mic,
  Lock,
  CheckCircle2,
  BookOpen,
  AlignLeft,
  MessageSquare,
  Clock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';
import { archiveToS5 } from '@/lib/s5Archive';

type TaskType = 'word' | 'phrase' | 'sentence';
type Difficulty = 'beginner' | 'intermediate' | 'advanced';

interface Task {
  id: string;
  english_text: string;
  description: string;
  type: TaskType;
  difficulty: Difficulty;
  estimated_time: number;
  language_id: string;
}

interface Language {
  id: string;
  name: string;
  code: string;
}

interface SectionProgress {
  word: number;
  phrase: number;
  sentence: number;
}

const SECTION_THRESHOLD = 1000;

const SECTION_CONFIG: Record<TaskType, { label: string; Icon: React.ElementType; unlockText: string }> = {
  word:     { label: 'Words',     Icon: BookOpen,      unlockText: '' },
  phrase:   { label: 'Phrases',   Icon: AlignLeft,     unlockText: 'Complete 1,000 Words to unlock' },
  sentence: { label: 'Sentences', Icon: MessageSquare, unlockText: 'Complete 1,000 Phrases to unlock' },
};

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  beginner:     'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  advanced:     'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const Chat = () => {
  const { languageId } = useParams<{ languageId: string }>();
  const navigate = useNavigate();

  const [user, setUser]                       = useState<User | null>(null);
  const [language, setLanguage]               = useState<Language | null>(null);
  const [currentTask, setCurrentTask]         = useState<Task | null>(null);
  const [sectionProgress, setSectionProgress] = useState<SectionProgress>({ word: 0, phrase: 0, sentence: 0 });
  const [currentSection, setCurrentSection]   = useState<TaskType>('word');
  const [generatingTask, setGeneratingTask]   = useState(false);
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);

  const { toast } = useToast();
  const { t }     = useTranslation();

  const totalRecordings = sectionProgress.word + sectionProgress.phrase + sectionProgress.sentence;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u);
      if (!u) navigate('/auth');
    });
  }, [navigate]);

  useEffect(() => {
    if (languageId && user) loadLanguage();
  }, [languageId, user]);

  useEffect(() => {
    if (language && user) generateNextTask();
  }, [language, user]);

  const loadLanguage = async () => {
    if (!languageId) return;
    const isValidUUID = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
    try {
      let resolved: Language | null = null;

      if (isValidUUID(languageId)) {
        const { data, error } = await supabase.from('languages').select('id, name, code').eq('id', languageId).maybeSingle();
        if (error) throw error;
        if (data) resolved = data as Language;
      }

      if (!resolved) {
        const { data, error } = await supabase.from('languages').select('id, name, code').eq('code', languageId).maybeSingle();
        if (error) throw error;
        if (data) resolved = data as Language;
      }

      if (!resolved) {
        const { getGlottologLanguages } = await import('@/utils/glottologParser');
        const gl = await getGlottologLanguages();
        const glottologLang = gl.find(l => l.id === languageId);
        if (!glottologLang) throw new Error('Language not found');

        const { data: ensured, error: ensureError } = await supabase.functions.invoke('upsert-language', {
          body: { code: glottologLang.id, name: glottologLang.name },
        });
        if (ensureError) throw ensureError;

        const candidate = (ensured?.language ?? ensured) as Language | null;
        if (candidate?.id) {
          resolved = candidate;
        } else {
          const { data } = await supabase.from('languages').select('id, name, code').eq('code', glottologLang.id).maybeSingle();
          if (data) resolved = data as Language;
        }
      }

      if (!resolved) throw new Error('Failed to resolve language');
      setLanguage(resolved);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({ title: t('chat.toasts.errorLoadLangTitle'), description: msg, variant: 'destructive' });
    }
  };

  const generateNextTask = async () => {
    if (!language || !user) return;
    setGeneratingTask(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-task', {
        body: { language_id: language.id },
      });

      if (error) throw error;

      if (data?.error) {
        toast({ title: t('chat.toasts.taskGenTitle'), description: data.error, variant: 'destructive' });
        return;
      }

      if (data?.task) setCurrentTask(data.task as Task);
      if (data?.section_progress) setSectionProgress(data.section_progress as SectionProgress);
      if (data?.section) setCurrentSection(data.section as TaskType);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({ title: t('chat.toasts.errorGenTitle'), description: msg, variant: 'destructive' });
    } finally {
      setGeneratingTask(false);
    }
  };

  const handleSubmitRecording = async (taskId: string, audioBlob: Blob, notes?: string) => {
    if (!user || !currentTask) return;

    try {
      const mime = audioBlob.type || 'audio/webm';
      const ext  = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';

      if (audioBlob.size < 1024) {
        throw new Error(t('chat.toasts.emptyRecording') ?? 'The recording seems empty. Please try again.');
      }

      const filePath = `${user.id}/${taskId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('recordings').upload(filePath, audioBlob, { contentType: mime });
      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from('recordings').getPublicUrl(filePath);
      const audioUrl = pub?.publicUrl || '';

      const getAudioDuration = (blob: Blob) =>
        new Promise<number>((resolve) => {
          const url   = URL.createObjectURL(blob);
          const audio = new Audio(url);
          const done  = (secs: number) => { URL.revokeObjectURL(url); resolve(secs); };
          audio.addEventListener('loadedmetadata', () => done(Math.round(audio.duration || 0)));
          audio.addEventListener('error', () => done(0));
        });

      const duration = await getAudioDuration(audioBlob);

      const { data: insertedRecording, error: insertError } = await supabase
        .from('recordings')
        .insert({ user_id: user.id, task_id: taskId, audio_url: audioUrl, notes, duration })
        .select('id')
        .single();
      if (insertError) throw insertError;

      archiveToS5({
        recording_id: insertedRecording.id,
        audio_url: audioUrl,
        file_path: filePath,
        metadata: {
          task_id: taskId,
          language: language?.name ?? '',
          language_code: language?.code ?? '',
          english_text: currentTask.english_text,
          task_type: currentTask.type,
          difficulty: currentTask.difficulty,
          user_id: user.id,
          duration,
          notes: notes || undefined,
          recorded_at: new Date().toISOString(),
        },
      }).then(r => {
        if (!r.success) console.warn('[S5] Archival failed (non-blocking):', r.error);
        else console.log('[S5] Archived — audio CID:', r.audio_cid, 'metadata CID:', r.metadata_cid);
      });

      setSectionProgress(prev => ({
        ...prev,
        [currentTask.type]: prev[currentTask.type] + 1,
      }));

      toast({ title: t('chat.toasts.saveSuccessTitle'), description: t('chat.toasts.saveSuccessDesc') });
      await generateNextTask();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({ title: t('chat.toasts.errorSaveTitle'), description: msg, variant: 'destructive' });
    } finally {
      setIsRecordingModalOpen(false);
    }
  };

  const SectionPanel = ({ type }: { type: TaskType }) => {
    const { label, Icon, unlockText } = SECTION_CONFIG[type];
    const count   = sectionProgress[type];
    const pct     = Math.min(100, (count / SECTION_THRESHOLD) * 100);
    const done    = count >= SECTION_THRESHOLD && type !== currentSection;
    const locked  = type === 'phrase'
      ? sectionProgress.word < SECTION_THRESHOLD
      : type === 'sentence'
        ? sectionProgress.phrase < SECTION_THRESHOLD
        : false;
    const active    = !locked && !done;
    const isCurrent = type === currentSection;

    return (
      <Card
        data-testid={`section-panel-${type}`}
        className={`transition-all ${
          isCurrent && !locked
            ? 'border-earth-primary shadow-md'
            : locked
              ? 'opacity-60'
              : 'border-border'
        }`}
      >
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Icon className={`w-4 h-4 ${isCurrent && !locked ? 'text-earth-primary' : 'text-muted-foreground'}`} />
              <span className={`text-sm font-medium ${isCurrent && !locked ? 'text-foreground' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </div>
            {done   && <CheckCircle2 className="w-4 h-4 text-green-500" data-testid={`section-done-${type}`} />}
            {locked && <Lock className="w-3.5 h-3.5 text-muted-foreground" data-testid={`section-locked-${type}`} />}
            {active && isCurrent && (
              <Badge className="text-[10px] px-1.5 py-0 bg-earth-primary text-white">Active</Badge>
            )}
          </div>

          {locked ? (
            <p className="text-[11px] text-muted-foreground leading-tight">{unlockText}</p>
          ) : (
            <>
              <Progress value={pct} className="h-1.5" data-testid={`section-progress-bar-${type}`} />
              <p className="text-[11px] text-muted-foreground text-right">
                <span data-testid={`section-count-${type}`}>{count.toLocaleString()}</span>
                {' / '}{SECTION_THRESHOLD.toLocaleString()}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-background" data-testid="chat-page">

      <div className="bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/chats')}
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-base truncate" data-testid="text-language-name">
            {language?.name ?? '…'}
          </h1>
          <p className="text-xs text-muted-foreground" data-testid="text-total-recordings">
            {totalRecordings.toLocaleString()} recording{totalRecordings !== 1 ? 's' : ''} completed
          </p>
        </div>
      </div>

      <div className="p-3 grid grid-cols-3 gap-2 border-b border-border bg-card/50">
        <SectionPanel type="word" />
        <SectionPanel type="phrase" />
        <SectionPanel type="sentence" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">

        {generatingTask ? (
          <div className="w-full max-w-md space-y-3" data-testid="task-loading">
            <Skeleton className="h-6 w-32 mx-auto" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : currentTask ? (
          <Card className="w-full max-w-md shadow-lg" data-testid={`task-card-${currentTask.id}`}>
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs capitalize" data-testid="badge-task-type">
                  {currentTask.type}
                </Badge>
                <Badge
                  className={`text-xs capitalize ${DIFFICULTY_COLOR[currentTask.difficulty]}`}
                  data-testid="badge-difficulty"
                >
                  {currentTask.difficulty}
                </Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                  <Clock className="w-3 h-3" />
                  <span data-testid="text-estimated-time">~{currentTask.estimated_time} min</span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="px-5 pb-5 space-y-4">
              <p className="text-2xl font-semibold text-center py-2" data-testid="text-task-english">
                {currentTask.english_text}
              </p>

              {currentTask.description && (
                <p className="text-sm text-muted-foreground text-center" data-testid="text-task-description">
                  {currentTask.description}
                </p>
              )}

              <Button
                onClick={() => setIsRecordingModalOpen(true)}
                className="w-full bg-earth-primary hover:bg-earth-primary/90"
                size="lg"
                data-testid="button-record"
              >
                <Mic className="w-5 h-5 mr-2" />
                Record in {language?.name}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center text-muted-foreground" data-testid="task-empty">
            <p className="text-sm">No task available. Tap below to generate one.</p>
            <Button
              onClick={() => generateNextTask()}
              className="mt-4 bg-earth-primary hover:bg-earth-primary/90"
              data-testid="button-generate-task"
            >
              Generate Task
            </Button>
          </div>
        )}

        {!generatingTask && currentTask && (
          <p className="text-xs text-muted-foreground text-center max-w-xs" data-testid="text-section-hint">
            {currentSection === 'word' && sectionProgress.word < SECTION_THRESHOLD
              ? `Record ${SECTION_THRESHOLD - sectionProgress.word} more words to unlock Phrases`
              : currentSection === 'phrase' && sectionProgress.phrase < SECTION_THRESHOLD
                ? `Record ${SECTION_THRESHOLD - sectionProgress.phrase} more phrases to unlock Sentences`
                : currentSection === 'sentence'
                  ? `Recording sentence ${sectionProgress.sentence + 1} of ${SECTION_THRESHOLD}`
                  : null}
          </p>
        )}
      </div>

      <RecordingModal
        isOpen={isRecordingModalOpen}
        onClose={() => setIsRecordingModalOpen(false)}
        task={currentTask ? {
          id:            currentTask.id,
          type:          currentTask.type,
          englishText:   currentTask.english_text,
          description:   currentTask.description,
          difficulty:    currentTask.difficulty,
          estimatedTime: currentTask.estimated_time,
          sequenceOrder: 0,
          isStarterTask: false,
          isCompleted:   false,
        } : null}
        onSubmit={handleSubmitRecording}
      />
    </div>
  );
};

export default Chat;
