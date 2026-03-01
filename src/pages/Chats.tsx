import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Search,
  MessageCircle,
  Clock,
  Mic,
  Plus
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';

interface ActiveChat {
  language_id: string;
  language_name: string;
  language_code: string;
  total_tasks: number;
  completed_recordings: number;
  last_activity: string;
}

const Chats = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [activeChats, setActiveChats] = useState<ActiveChat[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
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
    if (user) {
      loadActiveChats();
    }
  }, [user]);

  const loadActiveChats = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('recordings')
        .select(`
          task_id,
          created_at,
          tasks!inner(
            language_id,
            languages!inner(
              id,
              name,
              code
            )
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Group by language and calculate stats
      const chatMap = new Map<string, ActiveChat>();
      
      data?.forEach(recording => {
        const language = recording.tasks.languages;
        const languageId = language.id;
        
        if (!chatMap.has(languageId)) {
          chatMap.set(languageId, {
            language_id: languageId,
            language_name: language.name,
            language_code: language.code,
            total_tasks: 0,
            completed_recordings: 0,
            last_activity: recording.created_at
          });
        }
        
        const chat = chatMap.get(languageId)!;
        chat.completed_recordings++;
        if (new Date(recording.created_at) > new Date(chat.last_activity)) {
          chat.last_activity = recording.created_at;
        }
      });

      // Get total tasks for each language
      for (const [languageId, chat] of chatMap.entries()) {
        const { count } = await supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('language_id', languageId);
        
        chat.total_tasks = count || 0;
      }

      setActiveChats(Array.from(chatMap.values()));
    } catch (error: any) {
      toast({
        title: t('chats.errors.loadTitle'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredChats = activeChats.filter(chat =>
    chat.language_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chat.language_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatLastActivity = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return t('common.today');
    } else if (diffDays === 1) {
      return t('common.yesterday');
    } else if (diffDays < 7) {
      return t('common.daysAgo', { count: diffDays });
    } else {
      return date.toLocaleDateString();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <MessageCircle className="w-12 h-12 text-earth-primary mx-auto mb-4 animate-pulse" />
          <p className="text-lg text-muted-foreground">{t('chats.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('chats.title')}</h1>
          <p className="text-muted-foreground">
            {t('chats.subtitle')}
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-6">
  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
  <Input
    placeholder={t('chats.searchPlaceholder')}
    value={searchTerm}
    onChange={(e) => setSearchTerm(e.target.value)}
    className="pl-9"
  />
        </div>

        {/* New Chat Button */}
        <Button
          onClick={() => navigate('/')}
          className="w-full mb-6 bg-earth-primary hover:bg-earth-primary/90"
          size="lg"
        >
  <Plus className="w-5 h-5 mr-2" />
  {t('chats.startNew')}
        </Button>

        {/* Active Chats */}
        {filteredChats.length > 0 ? (
          <div className="space-y-4">
            {filteredChats.map((chat) => (
              <Card 
                key={chat.language_id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/chat/${chat.language_id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{chat.language_name}</CardTitle>
                    <Badge variant="outline" className="text-earth-primary">
                      {chat.language_code}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-1">
                        <Mic className="w-4 h-4 text-earth-primary" />
                        <span className="text-sm font-medium">
                          {chat.completed_recordings} {t('home.recordings')}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1 text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">
                          {formatLastActivity(chat.last_activity)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-earth-primary h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${Math.min((chat.completed_recordings / Math.max(chat.total_tasks, 1)) * 100, 100)}%` 
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('chats.progressSummary', { completed: chat.completed_recordings, total: chat.total_tasks })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <MessageCircle className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">{t('chats.emptyTitle')}</h3>
              <p className="text-muted-foreground mb-6">
                {t('chats.emptyDesc')}
              </p>
              <Button
                onClick={() => navigate('/')}
                className="bg-earth-primary hover:bg-earth-primary/90"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('chats.startRecordingBtn')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Chats;