import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Returns a Set of certification_ids that have at least one published course_package.
 * Used to show "Coming Soon" on landing pages for certifications without a ready course.
 */
export function usePublishedCertifications() {
  return useQuery({
    queryKey: ['published-certification-ids'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_packages')
        .select('certification_id')
        .eq('status', 'published')
        .not('certification_id', 'is', null);
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.certification_id));
    },
    staleTime: 5 * 60 * 1000, // 5 min cache
  });
}
