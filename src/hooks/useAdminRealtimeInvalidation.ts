import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Gold-Pattern: Realtime events → invalidateQueries (SSOT, no shadow state)
 * Use this hook to subscribe to Postgres changes and auto-invalidate React Query caches.
 */
export function useRealtimeInvalidation(
  table: string,
  queryKeys: string[][],
  channelSuffix?: string
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channelName = `rt-inv-${table}-${channelSuffix || 'default'}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          queryKeys.forEach(key => {
            queryClient.invalidateQueries({ queryKey: key });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, queryClient, channelSuffix]);
  // queryKeys intentionally excluded — caller should memoize or use stable refs
}

/**
 * Subscribe to multiple tables at once for broader admin invalidation
 */
export function useMultiTableRealtimeInvalidation(
  configs: { table: string; queryKeys: string[][] }[]
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase.channel('admin-multi-rt');

    configs.forEach(({ table, queryKeys }) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          queryKeys.forEach(key => {
            queryClient.invalidateQueries({ queryKey: key });
          });
        }
      );
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
