import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useReferral = () => {
  // Capture ?ref= param and stash it until the user completes auth
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const ref = url.searchParams.get('ref');
      if (ref) {
        localStorage.setItem('referrer_id', ref);
        // Clean the URL
        url.searchParams.delete('ref');
        const cleaned = url.pathname + (url.search ? `?${url.searchParams.toString()}` : '') + url.hash;
        window.history.replaceState({}, document.title, cleaned);
      }
    } catch {}
  }, []);

  // When a user is logged in, attempt to record the referral one time
  useEffect(() => {
    const applyReferral = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const referrerId = localStorage.getItem('referrer_id');
      if (!user || !referrerId) return;
      if (referrerId === user.id) {
        localStorage.removeItem('referrer_id');
        return;
      }

      const claimedKey = `referral_claimed_${user.id}`;
      if (localStorage.getItem(claimedKey)) return;

      const { error } = await (supabase as any)
        .from('referrals')
        .insert({ referrer_id: referrerId, referred_user_id: user.id });

      // Clear local storage if success or duplicate
      // Postgres unique_violation code: 23505
      const duplicate = (error as any)?.code === '23505';
      if (!error || duplicate) {
        localStorage.removeItem('referrer_id');
        localStorage.setItem(claimedKey, '1');
      }
    };

    applyReferral();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session?.user) applyReferral();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);
};
