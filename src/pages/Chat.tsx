import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RecordingModal } from '@/components/RecordingModal';
import { 
  ArrowLeft, 
  Mic, 
  Play, 
  Pause,
  ChevronRight,
  Clock,
  Volume2
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';

interface Message {
  id: string;
  type: 'system' | 'user';
  content: string;
  taskType: 'word' | 'phrase' | 'sentence';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number;
  audioUrl?: string;
  isCompleted?: boolean;
  timestamp: Date;
  // Added metadata to support multi-recording UI/logic
  taskId?: string;
  recordingIndex?: number; // 1-based index of this recording for the task
  recordingsCount?: number; // total user recordings for this task
}

interface Language {
  id: string;
  name: string;
  code: string;
}

const Chat = () => {
  const { languageId } = useParams<{ languageId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [language, setLanguage] = useState<Language | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const [currentTask, setCurrentTask] = useState<Message | null>(null);
  const [generatingTask, setGeneratingTask] = useState(false);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ recordings_count: number; can_generate_next: boolean } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (!user) {
        navigate('/auth');
      }
    });
  }, [navigate]);

  useEffect(() => {
    if (languageId && user) {
      loadLanguage();
    }
  }, [languageId, user]);

  useEffect(() => {
    if (language && user) {
      loadChatHistory();
      loadProgress();
    }
  }, [language, user]);

  // Auto-generate first task if no messages exist
  useEffect(() => {
    if (messages.length === 0 && language && user && !generatingTask && progress !== null) {
      generateNextTask();
    }
  }, [messages, language, user, progress]);
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadLanguage = async () => {
    if (!languageId) return;

    const isValidUUID = (str: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

    try {
      let data: any = null;

      // If the route param looks like a UUID, try by id first
      if (isValidUUID(languageId)) {
        const { data: byId, error: byIdError } = await supabase
          .from('languages')
          .select('*')
          .eq('id', languageId)
          .maybeSingle();

        if (byIdError) throw byIdError;
        if (byId) data = byId;
      }

      // Fallback: try by code (Glottolog ID)
      if (!data) {
        const { data: byCode, error: byCodeError } = await supabase
          .from('languages')
          .select('*')
          .eq('code', languageId)
          .maybeSingle();

        if (byCodeError) throw byCodeError;
        if (byCode) data = byCode;
      }

      // If still not found, create via edge function (bypasses RLS) using Glottolog metadata
      if (!data) {
        const { getGlottologLanguages } = await import('@/utils/glottologParser');
        const glottologLanguages = await getGlottologLanguages();
        const glottologLang = glottologLanguages.find((lang) => lang.id === languageId);

        if (!glottologLang) {
          throw new Error('Language not found');
        }

        const { data: ensured, error: ensureError } = await supabase.functions.invoke('upsert-language', {
          body: { code: glottologLang.id, name: glottologLang.name },
        });
        if (ensureError) throw ensureError;

        // Edge function returns the language row
        data = ensured?.language ?? ensured;

        // As a safety net, fetch again by code if needed
        if (!data?.id) {
          const { data: inserted } = await supabase
            .from('languages')
            .select('*')
            .eq('code', glottologLang.id)
            .maybeSingle();
          data = inserted;
        }
      }

      if (!data) throw new Error('Failed to resolve language');
      setLanguage(data);
    } catch (error: any) {
      toast({
        title: t('chat.toasts.errorLoadLangTitle'),
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const loadProgress = async () => {
    if (!user || !language) return null as { recordings_count: number; can_generate_next: boolean } | null;
    try {
      const { data, error } = await supabase
        .from('user_task_progress')
        .select('recordings_count, can_generate_next')
        .eq('user_id', user.id)
        .eq('language_id', language.id)
        .maybeSingle();
      if (error) throw error;
      const value = data ?? { recordings_count: 0, can_generate_next: false };
      setProgress(value);
      return value;
    } catch (error: any) {
      // Non-blocking: just log and continue
      console.warn('Failed to load progress', error);
      return null;
    }
  };

  const loadChatHistory = async () => {
    if (!user || !language) return;

    try {
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          *,
          recordings!left(id, user_id, audio_url, created_at)
        `)
        .eq('language_id', language.id) // Use the actual database language ID
        .order('created_at', { ascending: true });

      if (error) throw error;

      const chatMessages: Message[] = [];
      
      data?.forEach(task => {
        // Add system message (task prompt)
        chatMessages.push({
          id: task.id,
          type: 'system',
          content: task.english_text,
          taskType: task.type as 'word' | 'phrase' | 'sentence',
          difficulty: task.difficulty as 'beginner' | 'intermediate' | 'advanced',
          estimatedTime: task.estimated_time,
          timestamp: new Date(task.created_at),
          taskId: task.id,
        });

        // Add all user recordings (in order)
        const userRecordings = (task.recordings || [])
          .filter((r: any) => r.user_id === user.id)
          .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        userRecordings.forEach((r: any, idx: number) => {
          chatMessages.push({
            id: `${task.id}-recording-${idx + 1}`,
            type: 'user',
            content: t('chat.recorded', { text: task.english_text }),
            taskType: task.type as 'word' | 'phrase' | 'sentence',
            difficulty: task.difficulty as 'beginner' | 'intermediate' | 'advanced',
            estimatedTime: task.estimated_time,
            audioUrl: r.audio_url,
            isCompleted: true,
            timestamp: new Date(r.created_at),
            taskId: task.id,
            recordingIndex: idx + 1,
            recordingsCount: userRecordings.length,
          });
        });
      });

      setMessages(chatMessages);
    } catch (error: any) {
      toast({
        title: "Error loading chat history",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const generateNextTask = async (force = false) => {
    if (!language || !user) return;

    // Guard: require sufficient progress before generating next task (allow first task)
    if (!force && messages.length > 0 && (!progress || !progress.can_generate_next)) {
      toast({
        title: t('chat.toasts.needMoreTitle'),
        description: t('chat.toasts.needMoreDesc'),
        variant: 'destructive',
      });
      return;
    }

    setGeneratingTask(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-task', {
        body: {
          language_id: language.id, // Use the actual database language ID
          user_id: user.id,
          force
        }
      });

      if (error) throw error;

      if (data.error) {
        toast({
          title: t('chat.toasts.taskGenTitle'),
          description: data.error,
          variant: "destructive",
        });
        return;
      }

      // Reload chat to show new task
      loadChatHistory();
      
      toast({
        title: t('chat.toasts.newTaskTitle'),
        description: t('chat.toasts.newTaskDesc'),
      });
    } catch (error: any) {
      toast({
        title: t('chat.toasts.errorGenTitle'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setGeneratingTask(false);
    }
  };

  const handleStartRecording = (message: Message) => {
    setCurrentTask(message);
    setIsRecordingModalOpen(true);
  };

  const handleSubmitRecording = async (taskId: string, audioBlob: Blob, notes?: string) => {
    if (!user) return;

    try {
      // Helper to compute duration from blob
      const getAudioDuration = (blob: Blob) =>
        new Promise<number>((resolve) => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          const cleanup = () => URL.revokeObjectURL(url);
          audio.addEventListener('loadedmetadata', () => {
            const sec = Math.round(audio.duration || 0);
            cleanup();
            resolve(Number.isFinite(sec) ? sec : 0);
          });
          audio.addEventListener('error', () => {
            cleanup();
            resolve(0);
          });
        });

      // 1) Determine content type and extension, guard against empty blob
      const mime = audioBlob.type || 'audio/webm';
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
      if (!audioBlob || audioBlob.size < 1024) {
        throw new Error(t('chat.toasts.emptyRecording') ?? 'The recording seems empty. Please try again.');
      }
      const filePath = `${user.id}/${taskId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('recordings')
        .upload(filePath, audioBlob, { contentType: mime });
      if (uploadError) throw uploadError;

      // 2) Get a public URL
      const { data: pub } = supabase.storage.from('recordings').getPublicUrl(filePath);
      const audioUrl = pub?.publicUrl || '';

      // 3) Calculate duration
      const duration = await getAudioDuration(audioBlob);

      // 4) Insert the new recording with the real URL and duration
      const { data: insertedRecording, error: insertError } = await supabase
        .from('recordings')
        .insert({
          user_id: user.id,
          task_id: taskId,
          audio_url: audioUrl,
          notes: notes,
          duration,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      // 5) Archive to Sia (fire-and-forget, don't block the UI)
      supabase.functions.invoke('archive-to-sia', {
        body: {
          recording_id: insertedRecording.id,
          audio_url: audioUrl,
          file_path: filePath,
        },
      }).then(({ error }) => {
        if (error) console.warn('Sia archival failed (will retry later):', error);
        else console.log('Recording archived to Sia successfully');
      });

      // 5) Optimistically add the new recording to the chat UI
      const sysMessage = messages.find((m) => m.type === 'system' && m.id === taskId);
      const existingIndexes = messages
        .filter((m) => m.type === 'user' && m.id.startsWith(`${taskId}-recording-`))
        .map((m) => {
          const parts = m.id.split('-recording-');
          return Number(parts[1] || 0);
        });
      const nextIndex = (existingIndexes.length ? Math.max(...existingIndexes) : 0) + 1;

      const optimisticMessage: Message = {
        id: `${taskId}-recording-${nextIndex}`,
        type: 'user',
        content: t('chat.recorded', { text: sysMessage?.content ?? '' }),
        taskType: (sysMessage?.taskType as Message['taskType']) ?? 'sentence',
        difficulty: (sysMessage?.difficulty as Message['difficulty']) ?? 'beginner',
        estimatedTime: sysMessage?.estimatedTime ?? 2,
        audioUrl,
        isCompleted: true,
        timestamp: new Date(),
        taskId,
        recordingIndex: nextIndex,
        recordingsCount: nextIndex,
      };

      setMessages((prev) => {
        const updatedPrev = prev.map((m) => {
          const isSameTaskUserRecording =
            m.type === 'user' && ((m.taskId && m.taskId === taskId) || m.id.startsWith(`${taskId}-recording`));
          return isSameTaskUserRecording ? { ...m, recordingsCount: nextIndex } : m;
        });
        return [...updatedPrev, optimisticMessage];
      });

      toast({
        title: t('chat.toasts.saveSuccessTitle'),
        description: t('chat.toasts.saveSuccessDesc'),
      });

      // 6) Reconcile with server in the background and decide on next task
      const [{ count: totalCount, error: countAfterError }, updated] = await Promise.all([
        supabase
          .from('recordings')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('task_id', taskId),
        loadProgress(),
      ]);

      if (countAfterError) {
        console.warn('Failed to count recordings after insert', countAfterError);
      }

      const recordingsTotal = totalCount ?? nextIndex;

      if (recordingsTotal >= 2 || updated?.can_generate_next) {
        await generateNextTask(true);
        await Promise.all([loadChatHistory(), loadProgress()]);
      } else {
        setTimeout(() => {
          loadChatHistory();
          loadProgress();
        }, 800);
      }
    } catch (error: any) {
      toast({
        title: t('chat.toasts.errorSaveTitle'),
        description: error.message,
        variant: 'destructive',
      });
    }

    setIsRecordingModalOpen(false);
    setCurrentTask(null);
  };

  const playAudio = (audioUrl: string) => {
    try {
      // Toggle pause if same URL is playing
      if (playingAudio === audioUrl) {
        audioRef.current?.pause();
        audioRef.current = null;
        setPlayingAudio(null);
        return;
      }

      // Stop any existing playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setPlayingAudio(audioUrl);

      audio.onended = () => setPlayingAudio(null);
      audio.onerror = () => {
        setPlayingAudio(null);
        toast({ title: t('chat.playback.error'), description: t('chat.playback.cannotPlay') });
      };

      audio.play().catch(() => {
        setPlayingAudio(null);
        toast({ title: t('chat.playback.error'), description: t('chat.playback.autoplayPrevented') });
      });
    } catch (e: any) {
      setPlayingAudio(null);
      toast({ title: t('chat.playback.error'), description: e.message });
    }
  };

  const getNextIncompleteTask = () => {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type === 'system') {
        const hasAnyUserRecording = messages.some(
          (m) => m.type === 'user' && ((m.taskId && m.taskId === msg.id) || m.id.startsWith(`${msg.id}-recording`))
        );
        if (!hasAnyUserRecording) {
          return msg;
        }
      }
    }
    return null;
  };

  const nextIncompleteTask = getNextIncompleteTask();
  
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 flex items-center space-x-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/chats')}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-semibold text-lg">{language?.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t('chat.header.recordingsCompleted', { count: messages.filter(m => m.type === 'user').length })}
          </p>
        </div>
      </div>

      {/* Manual Next Task (left side) */}
      <div className="hidden md:block fixed left-4 top-1/2 -translate-y-1/2 z-20">
        <Button
          variant="outline"
          onClick={() => generateNextTask(true)}
          disabled={generatingTask}
          size="sm"
        >
          <ChevronRight className="w-4 h-4 mr-2" />
          {t('chat.buttons.nextTask')}
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          const isUser = message.type === 'user';
          const showRecordAgainAfterThis =
            isUser &&
            (message.recordingIndex ?? 0) === (message.recordingsCount ?? 0) &&
            (message.recordingsCount ?? 0) < 2;

          return (
            <div key={message.id} className="space-y-2">
              <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <Card className={`max-w-[80%] p-4 ${isUser ? 'bg-earth-primary text-white' : 'bg-card'}`}>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="text-xs">{t(`task.type.${message.taskType}`)}</Badge>
                      <Badge variant="outline" className="text-xs">{t(`task.difficulty.${message.difficulty}`)}</Badge>
                      <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{t('task.approxMinutes', { minutes: message.estimatedTime })}</span>
                      </div>
                    </div>

                    <p className="text-sm">{message.content}</p>

                    {isUser && message.audioUrl && (
                      <div className="flex items-center justify-end">
                        <Button variant="ghost" size="sm" onClick={() => playAudio(message.audioUrl!)} className="p-1 h-8 w-8">
                          {playingAudio === message.audioUrl ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    )}

                    {message.type === 'system' && !messages.some(m => m.type === 'user' && ((m.taskId && m.taskId === message.id) || m.id.startsWith(`${message.id}-recording`))) && (
                      <Button size="sm" onClick={() => handleStartRecording(message)} className="bg-earth-primary hover:bg-earth-primary/90">
                        <Mic className="w-4 h-4 mr-2" />
                        {t('chat.buttons.record')}
                      </Button>
                    )}
                  </div>
                </Card>
              </div>

              {showRecordAgainAfterThis && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => {
                      const sysMessage = messages.find(
                        (m) => m.type === 'system' && m.id === (message.taskId ?? message.id.split('-recording')[0])
                      );
                      if (sysMessage) handleStartRecording(sysMessage);
                    }}
                    className="bg-earth-primary hover:bg-earth-primary/90"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    {t('chat.buttons.recordAgain')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Actions */}
      <div className="border-t border-border p-4">
        {nextIncompleteTask ? (
          <Button
            onClick={() => handleStartRecording(nextIncompleteTask)}
            className="w-full bg-earth-primary hover:bg-earth-primary/90"
            size="lg"
          >
            <Mic className="w-5 h-5 mr-2" />
            {t('chat.buttons.recordCurrent')}
          </Button>
        ) : (
          <Button
            onClick={() => generateNextTask()}
            disabled={generatingTask || !(progress?.can_generate_next)}
            className="w-full bg-earth-primary hover:bg-earth-primary/90"
            size="lg"
          >
            <ChevronRight className="w-5 h-5 mr-2" />
            {generatingTask ? t('chat.buttons.generating') : (progress?.can_generate_next ? t('chat.buttons.nextTask') : t('chat.buttons.recordToUnlock'))}
          </Button>
        )}
      </div>

      {/* Recording Modal */}
      <RecordingModal
        isOpen={isRecordingModalOpen}
        onClose={() => setIsRecordingModalOpen(false)}
        task={currentTask ? {
          id: currentTask.id,
          type: currentTask.taskType,
          englishText: currentTask.content,
          description: '',
          difficulty: currentTask.difficulty,
          estimatedTime: currentTask.estimatedTime,
          sequenceOrder: 0,
          isStarterTask: false,
          isCompleted: false
        } : null}
        onSubmit={handleSubmitRecording}
      />
    </div>
  );
};

export default Chat;