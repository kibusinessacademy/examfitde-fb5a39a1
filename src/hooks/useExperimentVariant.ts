import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Assigns the current user to a sticky experiment variant via the experiment-api.
 * Falls back to localStorage for anonymous users.
 */
export function useExperimentVariant(experimentId: string | null) {
  const { user } = useAuth();
  const [variant, setVariant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!experimentId) {
      setLoading(false);
      return;
    }

    const storageKey = `exp_variant_${experimentId}`;

    // Anonymous fallback: deterministic from localStorage
    if (!user) {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        setVariant(cached);
        setLoading(false);
        return;
      }
      // Simple random assignment for anon
      const roll = Math.random() * 100;
      const v = roll < 34 ? 'A' : roll < 67 ? 'B' : 'C';
      localStorage.setItem(storageKey, v);
      setVariant(v);
      setLoading(false);
      return;
    }

    // Authenticated: use experiment-api for sticky DB assignment
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('experiment-api', {
          body: { action: 'assign', experimentId },
        });
        if (!cancelled && !error && data?.variant) {
          setVariant(data.variant);
          localStorage.setItem(storageKey, data.variant);
        }
      } catch {
        // Fallback to cached or random
        const cached = localStorage.getItem(storageKey);
        if (!cancelled) setVariant(cached ?? 'A');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [experimentId, user?.id]);

  return { variant, loading };
}
