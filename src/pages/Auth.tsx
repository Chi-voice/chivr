import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Mic, Chrome } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const Auth = () => {
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [loading, setLoading] = useState(false);
const [activeTab, setActiveTab] = useState('signin');
const [consentChecked, setConsentChecked] = useState(false);
const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    // Check if user is already logged in
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate('/');
      }
    };
    checkUser();
  }, [navigate]);

const handleEmailAuth = async (type: 'signin' | 'signup') => {
  if (!consentChecked) {
    toast({
      title: t('auth.errorTitle'),
      description: t('auth.acceptTermsRequired', { defaultValue: 'Please accept the terms to continue.' }),
      variant: 'destructive',
    });
    return;
  }
  setLoading(true);
  try {
      if (type === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`
          }
        });
        
        if (error) throw error;
        
        toast({
          title: t('auth.checkEmailTitle'),
          description: t('auth.checkEmailDesc'),
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        
        if (error) throw error;
        
        toast({
          title: t('auth.welcomeBackTitle'),
          description: t('auth.welcomeBackDesc'),
        });
        navigate('/');
      }
    } catch (error: any) {
      toast({
        title: t('auth.errorTitle'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

const handleGoogleAuth = async () => {
  if (!consentChecked) {
    toast({
      title: t('auth.errorTitle'),
      description: t('auth.acceptTermsRequired', { defaultValue: 'Please accept the terms to continue.' }),
      variant: 'destructive',
    });
    return;
  }
  setLoading(true);
  try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`
        }
      });
      
      if (error) throw error;
    } catch (error: any) {
      toast({
        title: t('auth.errorTitle'), 
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-earth-warm via-background to-earth-warm/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <h1 className="text-2xl font-bold text-earth-deep">{t('app.title')}</h1>
          </div>
          <CardTitle>{t('auth.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('auth.subtitle')}
          </p>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t('auth.signin')}</TabsTrigger>
              <TabsTrigger value="signup">{t('auth.signup')}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin" className="space-y-4 mt-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">{t('auth.email')}</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder={t('auth.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">{t('auth.password')}</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button 
                  onClick={() => handleEmailAuth('signin')} 
                  className="w-full"
                  disabled={loading || !consentChecked}
                >
                  {loading ? t('auth.signingIn') : t('auth.signin')}
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="signup" className="space-y-4 mt-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">{t('auth.email')}</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder={t('auth.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">{t('auth.password')}</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button 
                  onClick={() => handleEmailAuth('signup')} 
                  className="w-full"
                  disabled={loading || !consentChecked}
                >
                  {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                {t('auth.orContinue')}
              </span>
            </div>
          </div>

          <Button 
            variant="outline" 
            onClick={handleGoogleAuth}
            className="w-full"
            disabled={loading || !consentChecked}
          >
            <Chrome className="w-4 h-4 mr-2" />
            {t('auth.continueWithGoogle')}
          </Button>

          <div className="mt-6">
            <div className="flex items-start gap-3 justify-center">
              <Checkbox
                id="consent"
                checked={consentChecked}
                onCheckedChange={(v) => setConsentChecked(!!v)}
                aria-describedby="consent-note"
              />
              <Label htmlFor="consent" className="text-xs text-muted-foreground">
                <span id="consent-note">{t('auth.termsNote')}</span>
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;