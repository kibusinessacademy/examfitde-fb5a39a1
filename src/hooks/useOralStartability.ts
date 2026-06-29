import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type OralStartStatus =
  | 'ready'
  | 'no_curriculum'
  | 'login_required'
  | 'no_blueprints'
  | 'not_entitled'
  | 'checking'
  | 'error';

export interface OralStartability {
  status: OralStartStatus;
  entitled: boolean;
  hasBlueprints: boolean;
  blueprintCount: number;
  reason?: string;
}

/**
 * SSOT for "kann dieser Nutzer mit diesem Curriculum die mündliche Prüfung starten?"
 * Kombiniert: Auth + Entitlement (paid package, feature=oral_trainer) + Blueprint-Verfügbarkeit.
 * Wird vom CurriculumPicker (Badges) und vom Start-Button (gated) konsumiert.
 */
export function useOralStartability(curriculumId: string | null | undefined): OralStartability & { isLoading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;

  const enabled = !!curriculumId;

  const readinessQ = useQuery({
    queryKey: ['oral-readiness', curriculumId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('oral_curriculum_readiness' as any, {
        p_curriculum_id: curriculumId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        hasBlueprints: !!row?.has_blueprints,
        blueprintCount: Number(row?.blueprint_count ?? 0),
      };
    },
  });

  const entitlementQ = useQuery({
    queryKey: ['oral-entitlement', userId, curriculumId],
    enabled: enabled && !authLoading && !!userId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_product_access_by_curriculum' as any, {
        p_user_id: userId!,
        p_curriculum_id: curriculumId!,
        p_feature: 'oral_trainer',
      });
      if (error) throw error;
      return data === true;
    },
  });

  const isLoading =
    authLoading ||
    (enabled && readinessQ.isLoading) ||
    (enabled && !!userId && entitlementQ.isLoading);

  if (!curriculumId) {
    return {
      status: 'no_curriculum',
      entitled: false,
      hasBlueprints: false,
      blueprintCount: 0,
      isLoading: false,
    };
  }

  if (isLoading) {
    return {
      status: 'checking',
      entitled: false,
      hasBlueprints: false,
      blueprintCount: 0,
      isLoading: true,
    };
  }

  if (readinessQ.error) {
    return {
      status: 'error',
      entitled: false,
      hasBlueprints: false,
      blueprintCount: 0,
      reason: 'Verfügbarkeit konnte nicht geprüft werden.',
      isLoading: false,
    };
  }

  const hasBlueprints = !!readinessQ.data?.hasBlueprints;
  const blueprintCount = readinessQ.data?.blueprintCount ?? 0;

  if (!hasBlueprints) {
    return {
      status: 'no_blueprints',
      entitled: false,
      hasBlueprints: false,
      blueprintCount,
      isLoading: false,
    };
  }

  if (!userId) {
    return {
      status: 'login_required',
      entitled: false,
      hasBlueprints,
      blueprintCount,
      isLoading: false,
    };
  }

  const entitled = entitlementQ.data === true;
  if (!entitled) {
    return {
      status: 'not_entitled',
      entitled: false,
      hasBlueprints,
      blueprintCount,
      isLoading: false,
    };
  }

  return {
    status: 'ready',
    entitled: true,
    hasBlueprints,
    blueprintCount,
    isLoading: false,
  };
}

/**
 * Bulk-Variante für den Picker: prüft Blueprint-Verfügbarkeit für viele Curricula
 * auf einen Schlag (ohne Entitlement, das wird pro Auswahl gemacht).
 */
export function useOralCurriculaReadinessBulk(curriculumIds: string[]) {
  return useQuery({
    queryKey: ['oral-readiness-bulk', [...curriculumIds].sort().join(',')],
    enabled: curriculumIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('oral_curricula_readiness_bulk' as any, {
        p_curriculum_ids: curriculumIds,
      });
      if (error) throw error;
      const map = new Map<string, { hasBlueprints: boolean; blueprintCount: number }>();
      (data ?? []).forEach((row: any) => {
        map.set(row.curriculum_id, {
          hasBlueprints: !!row.has_blueprints,
          blueprintCount: Number(row.blueprint_count ?? 0),
        });
      });
      return map;
    },
  });
}
