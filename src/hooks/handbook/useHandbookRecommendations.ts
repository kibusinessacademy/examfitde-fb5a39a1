import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { HandbookRecommendation } from './types';

/** Fetch contextual recommendations, optionally filtered by trigger type */
export function useHandbookRecommendations(triggerType?: string) {
  return useQuery({
    queryKey: ['handbook-recommendations', triggerType],
    queryFn: async () => {
      let query = supabase
        .from('handbook_recommendations')
        .select(`*, chapter:handbook_chapters(*)`)
        .eq('is_active', true)
        .order('priority');

      if (triggerType) {
        query = query.eq('trigger_type', triggerType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as HandbookRecommendation[];
    },
  });
}
