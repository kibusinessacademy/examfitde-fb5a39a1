import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BundleProgress {
  total_competencies: number;
  bundles_total: number;
  bundles_done: number;
  bundles_failed: number;
  bundles_active: number;
  legacy_lessons: number;
  lesson_subjobs_total: number;
  lesson_subjobs_done: number;
}

const EMPTY: BundleProgress = {
  total_competencies: 0, bundles_total: 0, bundles_done: 0,
  bundles_failed: 0, bundles_active: 0, legacy_lessons: 0,
  lesson_subjobs_total: 0, lesson_subjobs_done: 0,
};

export function useCompetencyBundleProgress(packageId: string | null) {
  const [progress, setProgress] = useState<BundleProgress>(EMPTY);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!packageId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('get_competency_bundle_progress', {
        p_package_id: packageId,
      });
      if (!error && data) setProgress(data as BundleProgress);
    } catch { /* ignore */ }
    setLoading(false);
  }, [packageId]);

  useEffect(() => {
    fetch();
    if (!packageId) return;
    const interval = setInterval(fetch, 10_000);
    const ch = supabase
      .channel(`bundle-progress-${packageId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'job_queue',
        filter: `package_id=eq.${packageId}`,
      }, () => fetch())
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(ch); };
  }, [packageId, fetch]);

  return { progress, loading, refetch: fetch };
}
