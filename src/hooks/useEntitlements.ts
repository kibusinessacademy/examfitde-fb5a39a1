/**
 * @deprecated Phase 3: Legacy entitlement hooks. Use useProductAccess.ts instead.
 * This file is kept only for backward compatibility during transition.
 * All active pages now use useProductAccessByCurriculum or useProductAccess.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';

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

/** @deprecated Use useProductAccessByCurriculum instead */
export function useUserEntitlements(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['user-entitlements-legacy', user?.id, curriculumId],
    queryFn: async () => {
      // Legacy RPCs have been removed. Return empty array.
      console.warn('[DEPRECATED] useUserEntitlements called — migrate to useProductAccessByCurriculum');
      return [] as UserEntitlement[];
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

/** @deprecated Use useProductAccessByCurriculum instead */
export function useCheckEntitlement(curriculumId: string, feature: Feature) {
  return useProductAccessByCurriculum(curriculumId, feature);
}

/** @deprecated Use useProductAccessByCurriculum instead */
export function useHasAnyEntitlement(curriculumId: string) {
  const { data: hasAccess, isLoading } = useProductAccessByCurriculum(curriculumId);

  return {
    hasAccess: !!hasAccess,
    isLoading,
    entitlements: undefined,
  };
}
