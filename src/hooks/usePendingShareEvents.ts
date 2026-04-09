import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShareEvent } from '@/types/share';

export function usePendingShareEvents() {
  return useQuery({
    queryKey: ['share-events', 'pending'],
    queryFn: async (): Promise<ShareEvent[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('share_events' as any)
        .select('*')
        .eq('user_id', user.id)
        .eq('event_status', 'eligible')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return (data ?? []) as unknown as ShareEvent[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
