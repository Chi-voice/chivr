import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
  User,
  Trophy,
  Mic,
  Languages,
  LogOut,
  Edit2,
  Award,
  Clock,
  Target,
  Copy
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';

interface UserProfile {
  id: string;
  display_name?: string;
  avatar_url?: string;
  points: number;
  total_recordings: number;
  created_at: string;
}

interface UserStats {
  totalLanguages: number;
  totalMinutes: number;
  longestStreak: number;
  currentLevel: string;
}

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
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
      loadProfile();
      loadStats();
    }
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error: any) {
      toast({
        title: t('profile.loading'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const loadStats = async () => {
    if (!user) return;

    try {
      // Get unique languages recorded
      const { data: languageData } = await supabase
        .from('recordings')
        .select(`
          tasks!inner(
            language_id,
            estimated_time
          )
        `)
        .eq('user_id', user.id);

      const uniqueLanguages = new Set(
        languageData?.map(r => r.tasks.language_id) || []
      );

      const totalMinutes = languageData?.reduce(
        (sum, r) => sum + (r.tasks.estimated_time || 0), 0
      ) || 0;

      // Calculate level based on points
      const points = profile?.points || 0;
      let currentLevel = 'Beginner';
      if (points >= 1000) currentLevel = 'Expert';
      else if (points >= 500) currentLevel = 'Advanced';
      else if (points >= 200) currentLevel = 'Intermediate';

      setStats({
        totalLanguages: uniqueLanguages.size,
        totalMinutes,
        longestStreak: 7, // Placeholder for now
        currentLevel
      });
    } catch (error: any) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'Expert': return 'bg-purple-500';
      case 'Advanced': return 'bg-blue-500';
      case 'Intermediate': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const referralLink = `${window.location.origin}/?ref=${user?.id || ''}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <User className="w-12 h-12 text-earth-primary mx-auto mb-4 animate-pulse" />
          <p className="text-lg text-muted-foreground">{t('profile.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Profile Header */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-4 mb-6">
              <Avatar className="w-20 h-20">
                <AvatarImage src={profile?.avatar_url} />
                <AvatarFallback className="text-lg">
                  {getInitials(profile?.display_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h1 className="text-2xl font-bold">
                  {profile?.display_name || t('profile.user')}
                </h1>
                <p className="text-muted-foreground mb-2">
                  {t('profile.memberSince')} {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : t('profile.recently')}
                </p>
                <div className="flex items-center space-x-2">
                  <Badge className={`${getLevelColor(stats?.currentLevel || 'Beginner')} text-white`}>
                    {t(`profile.levels.${(stats?.currentLevel || 'Beginner').toLowerCase()}`)}
                  </Badge>
                  <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                    <Trophy className="w-4 h-4" />
                  <span>{profile?.points || 0} {t('profile.points')}</span>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm">
                <Edit2 className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6 text-center">
              <Mic className="w-8 h-8 text-earth-primary mx-auto mb-2" />
              <div className="text-2xl font-bold">{profile?.total_recordings || 0}</div>
              <div className="text-sm text-muted-foreground">{t('profile.recordings')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 text-center">
              <Languages className="w-8 h-8 text-earth-primary mx-auto mb-2" />
              <div className="text-2xl font-bold">{stats?.totalLanguages || 0}</div>
              <div className="text-sm text-muted-foreground">{t('profile.languages')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 text-center">
              <Clock className="w-8 h-8 text-earth-primary mx-auto mb-2" />
              <div className="text-2xl font-bold">{stats?.totalMinutes || 0}</div>
              <div className="text-sm text-muted-foreground">{t('profile.minutes')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 text-center">
              <Target className="w-8 h-8 text-earth-primary mx-auto mb-2" />
              <div className="text-2xl font-bold">{stats?.longestStreak || 0}</div>
              <div className="text-sm text-muted-foreground">{t('profile.dayStreak')}</div>
            </CardContent>
          </Card>
        </div>

        {/* Referral */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{t('profile.inviteTitle')}</span>
              <Badge>{t('profile.referral')}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Input readOnly value={referralLink} className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(referralLink);
                  toast({ title: t('profile.copied') });
                }}
              >
                <Copy className="w-4 h-4 mr-2" /> {t('profile.copy')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Achievements */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Award className="w-5 h-5" />
              <span>{t('profile.achievements')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center space-x-2 p-2 bg-muted rounded">
                <Trophy className="w-5 h-5 text-yellow-500" />
                <div>
                  <div className="font-medium text-sm">{t('profile.firstRecording')}</div>
                  <div className="text-xs text-muted-foreground">{t('profile.firstRecordingDesc')}</div>
                </div>
              </div>

              <div className="flex items-center space-x-2 p-2 bg-muted rounded opacity-50">
                <Languages className="w-5 h-5 text-gray-400" />
                <div>
                  <div className="font-medium text-sm">{t('profile.polyglot')}</div>
                  <div className="text-xs text-muted-foreground">{t('profile.polyglotDesc')}</div>
                </div>
              </div>

              <div className="flex items-center space-x-2 p-2 bg-muted rounded opacity-50">
                <Mic className="w-5 h-5 text-gray-400" />
                <div>
                  <div className="font-medium text-sm">{t('profile.voiceActor')}</div>
                  <div className="text-xs text-muted-foreground">{t('profile.voiceActorDesc')}</div>
                </div>
              </div>

              <div className="flex items-center space-x-2 p-2 bg-muted rounded opacity-50">
                <Clock className="w-5 h-5 text-gray-400" />
                <div>
                  <div className="font-medium text-sm">{t('profile.dedicated')}</div>
                  <div className="text-xs text-muted-foreground">{t('profile.dedicatedDesc')}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => navigate('/chats')}
          >
            <Languages className="w-4 h-4 mr-3" />
            {t('profile.viewActiveChats')}
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={handleSignOut}
          >
            <LogOut className="w-4 h-4 mr-3" />
            {t('profile.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Profile;