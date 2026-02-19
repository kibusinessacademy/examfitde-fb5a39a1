import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface PipelineEvent {
  id: string;
  step_key: string;
  event_type: string;
  progress: number | null;
  message: string | null;
  meta: any;
  created_at: string;
}

interface PipelineStatus {
  package_id: string;
  package_title: string | null;
  current_step: string;
  last_event_type: string;
  progress_percent: number | null;
  last_work_summary: string | null;
  last_event_at: string;
  seconds_since_last_event: number;
  is_stuck: boolean;
}

export function usePipelineTimeline(packageId?: string) {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    if (!packageId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from('course_pipeline_events')
      .select('id,step_key,event_type,progress,message,meta,created_at')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(50);
    setEvents(data || []);
    setLoading(false);
  }, [packageId]);

  useEffect(() => {
    fetchEvents();
    if (!packageId) return;
    const ch = supabase
      .channel(`pipeline-events-${packageId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'course_pipeline_events',
        filter: `package_id=eq.${packageId}`,
      }, () => fetchEvents())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [packageId, fetchEvents]);

  return { events, loading, refetch: fetchEvents };
}

export function usePipelineOverview() {
  const [statuses, setStatuses] = useState<PipelineStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('kpi_course_pipeline_status')
      .select('*')
      .order('last_event_at', { ascending: false })
      .limit(20);
    setStatuses(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 15_000);
    return () => clearInterval(interval);
  }, [fetch]);

  return { statuses, loading, refetch: fetch };
}
