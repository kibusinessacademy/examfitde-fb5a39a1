import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface UserEntitlement {
  curriculum_id: string;
  has_learning_course: boolean;
  has_exam_trainer: boolean;
  has_ai_tutor: boolean;
  has_oral_trainer: boolean;
  has_handbook?: boolean;
  valid_until: string;
}

type Feature = 'learning_course' | 'exam_trainer' | 'ai_tutor' | 'oral_trainer';

export function useUserEntitlements(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['user-entitlements', user?.id, curriculumId],
    queryFn: async () => {
      if (!user) return [];

      // v2: adds has_handbook column
      const { data, error } = await supabase
        .rpc('get_user_entitlements_v2' as any, {
          p_user_id: user.id,
          p_curriculum_id: curriculumId || null,
        });

      if (error) throw error;
      return (data || []) as UserEntitlement[];
    },
    enabled: !!user,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useCheckEntitlement(curriculumId: string, feature: Feature) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['check-entitlement', user?.id, curriculumId, feature],
    queryFn: async () => {
      if (!user || !curriculumId) return false;

      const { data, error } = await supabase
        .rpc('check_user_entitlement', {
          p_user_id: user.id,
          p_curriculum_id: curriculumId,
          p_feature: feature,
        });

      if (error) {
        console.error('Entitlement check error:', error);
        return false;
      }
      return data as boolean;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 60 * 1000,
  });
}

export function useHasAnyEntitlement(curriculumId: string) {
  const { data: entitlements, isLoading } = useUserEntitlements(curriculumId);
  
  const hasAccess = entitlements && entitlements.length > 0 && entitlements.some(e => 
    e.has_learning_course || e.has_exam_trainer || e.has_ai_tutor || e.has_oral_trainer
  );

  return {
    hasAccess: !!hasAccess,
    isLoading,
    entitlements,
  };
}
