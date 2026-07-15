import { useEffect } from 'react';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';

export function useAuthDeepLink() {
  const url = Linking.useLinkingURL();

  useEffect(() => {
    if (!url) return;

    const { params, errorCode } = getQueryParams(url);
    if (errorCode) {
      console.warn('Auth deep link error', errorCode);
      return;
    }

    const { access_token, refresh_token } = params;
    if (!access_token || !refresh_token) return;

    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) console.warn('Failed to set session from deep link', error.message);
    });
  }, [url]);
}
