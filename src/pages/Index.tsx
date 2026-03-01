import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Mic, 
  Users, 
  Globe, 
  Search,
  Heart,
  Languages
} from 'lucide-react';
import heroImage from '@/assets/hero-image.jpg';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getGlottologLanguages, type GlottologLanguage } from '@/utils/glottologParser';
import type { User } from '@supabase/supabase-js';

interface Language {
  id: string;
  name: string;
  code: string;
  is_popular: boolean;
  total_tasks?: number;
  total_recordings?: number;
}



const Index = () => {
  const [user, setUser] = useState<User | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [glottologLanguages, setGlottologLanguages] = useState<GlottologLanguage[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [generatingTask, setGeneratingTask] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Live stats
  const [recordingsCount, setRecordingsCount] = useState(0);
  const [languagesCount, setLanguagesCount] = useState(0);
  const [contributorsCount, setContributorsCount] = useState(0);

  // Set up auth state listener
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (!user) {
        navigate('/auth');
      }
    });
  }, [navigate]);

  // Load languages
  useEffect(() => {
    if (user) {
      loadLanguages();
      loadGlottologLanguages();
    }
  }, [user]);

  const loadLanguages = async () => {
    try {
      const { data, error } = await supabase
        .from('languages')
        .select('*')
        .order('is_popular', { ascending: false })
        .order('name');
      
      if (error) throw error;
      
      setLanguages(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading languages",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadGlottologLanguages = async () => {
    try {
      const glottologData = await getGlottologLanguages();
      setGlottologLanguages(glottologData);
    } catch (error: any) {
      console.error('Error loading Glottolog languages:', error);
    }
  };

  // Load live counts via public edge function
  const fetchCounts = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-public-stats');
      if (error) throw error;
      if (data) {
        setRecordingsCount(data.total_recordings ?? 0);
        setLanguagesCount(data.total_languages ?? 0);
        setContributorsCount(data.total_contributors ?? 0);
      }
    } catch (e) {
      console.error('Error fetching counts', e);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const poll = async () => {
      if (!isMounted) return;
      await fetchCounts();
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, []);

  const startLanguageChat = async (languageId: string) => {
    if (!user) return;

    // Navigate directly to chat page - let the chat page handle task generation
    navigate(`/chat/${languageId}`);
  };
  // Filter languages based on search - combine DB languages with Glottolog
  const glottologFormatted = glottologLanguages.map(lang => ({
    ...lang,
    code: lang.id, // Use glottolog ID as code
    region: lang.family || 'Unknown',
    is_popular: false,
    total_tasks: 0,
    total_recordings: 0
  }));
  
  type CombinedLanguage = Language | typeof glottologFormatted[0];
  
  const allLanguages: CombinedLanguage[] = [...languages, ...glottologFormatted];
  const filteredLanguages = allLanguages
    .filter((language: CombinedLanguage) =>
      language.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      language.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ('family' in language && language.family?.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .slice(0, 50); // Increased from 20 to 50 for better search results


  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-earth-warm via-background to-earth-warm/50 flex items-center justify-center">
        <div className="text-center">
          <Mic className="w-12 h-12 text-earth-primary mx-auto mb-4 animate-pulse" />
          <p className="text-lg text-muted-foreground">{t('home.heroTitle')}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-earth-warm via-background to-earth-warm/50 pb-20">

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div 
          className="h-96 bg-cover bg-center bg-no-repeat relative"
          style={{ backgroundImage: `url(${heroImage})` }}
        >
          <div className="absolute inset-0 bg-earth-deep/60" />
          <div className="relative container mx-auto px-4 h-full flex items-center">
            <div className="max-w-2xl text-white">
              <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-4">
                {t('home.heroTitle')}
              </h1>
              <p className="text-xl md:text-2xl mb-6 opacity-90">
                {t('home.heroSubtitle')}
              </p>
              <p className="text-lg mb-8 opacity-80">
                {t('home.heroDescription')}
              </p>
              <Button 
                size="lg" 
                className="bg-earth-primary hover:bg-earth-primary/90 text-white px-8"
                onClick={() => document.getElementById('languages')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <Mic className="w-5 h-5 mr-2" />
                {t('home.startRecording')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Mission Statement */}
      <div className="container mx-auto px-4 py-12">
        <Card className="mb-12 border-l-4 border-l-earth-primary">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Heart className="w-6 h-6 text-earth-primary" />
              <span>{t('home.mission')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t('home.missionDescription')}
            </p>
          </CardContent>
        </Card>

        {/* Language Selection */}
        <div id="languages" className="space-y-8">
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-bold text-foreground">{t('home.chooseLanguage')}</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t('home.chooseLanguageDescription')}
            </p>
          </div>

          {/* Search */}
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('home.searchLanguages')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Language Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredLanguages.map((language, index) => {
              const isDbLanguage = 'total_tasks' in language;
              const key = language.id || `${language.code}-${index}`;
              
              return (
                <Card 
                  key={key}
                  className="cursor-pointer hover:shadow-lg transition-shadow group"
                  onClick={() => {
                    if (isDbLanguage) {
                      startLanguageChat(language.id);
                    } else {
                      toast({
                        title: t('home.languageNotAvailable'),
                        description: t('home.languageNotAvailableDescription'),
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg group-hover:text-earth-primary transition-colors">
                          {language.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {language.code} • {isDbLanguage ? t('home.globalLabel') : ('family' in language ? String(language.family) : t('home.unknown'))}
                        </p>
                        {isDbLanguage && 'total_tasks' in language && language.total_tasks && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {language.total_tasks} {t('home.tasksAvailable')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {isDbLanguage && 'is_popular' in language && language.is_popular && (
                          <Badge variant="default" className="bg-earth-primary">
                            {t('home.popular')}
                          </Badge>
                        )}
                        <Languages className="w-5 h-5 text-muted-foreground group-hover:text-earth-primary transition-colors" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filteredLanguages.length === 0 && (
            <Card className="text-center py-12">
              <CardContent>
                <Globe className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">{t('home.noLanguagesFound')}</h3>
                <p className="text-muted-foreground">
                  {t('home.tryAdjustingSearch')}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Community Impact Section */}
        <Card className="mt-12 bg-gradient-to-r from-earth-primary to-earth-secondary text-white">
          <CardContent className="p-8 text-center">
            <Users className="w-16 h-16 mx-auto mb-4 opacity-90" />
            <h3 className="text-2xl font-bold mb-4">{t('home.joinCommunity')}</h3>
            <p className="text-lg opacity-90 mb-6 max-w-2xl mx-auto">
              {t('home.communityDescription')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-2xl mx-auto">
              <div>
                <div className="text-3xl font-bold">{recordingsCount.toLocaleString()}</div>
                <div className="opacity-80">{t('home.recordings')}</div>
              </div>
              <div>
                <div className="text-3xl font-bold">{languagesCount.toLocaleString()}</div>
                <div className="opacity-80">{t('home.languages')}</div>
              </div>
              <div>
                <div className="text-3xl font-bold">{contributorsCount.toLocaleString()}</div>
                <div className="opacity-80">{t('home.contributors')}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;
