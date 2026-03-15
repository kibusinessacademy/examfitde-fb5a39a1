import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AdminVisibleCoursePackage } from '@/types/admin-packages';

export function useAdminVisiblePackages() {
  return useQuery({
    queryKey: ['admin-visible-course-packages'],
    queryFn: async (): Promise<AdminVisibleCoursePackage[]> => {
      const { data, error } = await (supabase as any)
        .from('v_admin_visible_course_packages')
        .select('*')
        .order('priority', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return (data || []) as AdminVisibleCoursePackage[];
    },
    staleTime: 0,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
  });
}
