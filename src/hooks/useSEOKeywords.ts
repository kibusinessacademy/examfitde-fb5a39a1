import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface InternalLinkSuggestion {
  id: string;
  source_url: string;
  target_url: string;
  target_title: string;
  anchor_text: string;
  relevance_score: number;
  link_type: string;
  priority: number;
}

/**
 * Fetch active internal link suggestions for a given source URL
 */
export function useInternalLinks(sourceUrl: string) {
  return useQuery({
    queryKey: ['internal-links', sourceUrl],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seo_internal_link_suggestions')
        .select('id, source_url, target_url, target_title, anchor_text, relevance_score, link_type, priority')
        .eq('source_url', sourceUrl)
        .eq('status', 'active')
        .order('priority', { ascending: true });

      if (error) throw error;
      return (data ?? []) as InternalLinkSuggestion[];
    },
    enabled: !!sourceUrl,
  });
}
