import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OrgDashboardOverview {
  org_id: string;
  total_active_licenses: number;
  total_seats: number;
  used_seats: number;
  available_seats: number;
  active_learners: number;
}

export interface OrgLicense {
  license_id: string;
  product_id: string;
  product_title: string | null;
  seats_total: number;
  seats_used: number;
  seats_available: number;
  valid_from: string;
  valid_until: string | null;
  status: string;
  source_ref: string | null;
}

export interface OrgSeatMember {
  seat_id: string;
  license_id: string;
  user_id: string;
  product_id: string;
  product_title: string | null;
  claimed_at: string;
  released_at: string | null;
  seat_status: string;
}

export function useOrgDashboardOverview(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org-dashboard-overview', orgId],
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase.rpc('get_org_dashboard_overview' as any, { p_org_id: orgId });
      if (error) throw error;
      return data as OrgDashboardOverview;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useOrgLicenseList(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org-licenses', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc('get_org_license_list' as any, { p_org_id: orgId });
      if (error) throw error;
      return (data || []) as OrgLicense[];
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useOrgSeatMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org-seat-members', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc('get_org_seat_members' as any, { p_org_id: orgId });
      if (error) throw error;
      return (data || []) as OrgSeatMember[];
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useAssignOrgSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { licenseId: string; userId: string }) => {
      const { data, error } = await supabase.rpc('assign_org_license_seat' as any, {
        p_license_id: params.licenseId,
        p_user_id: params.userId,
      });
      if (error) throw error;
      const result = data as { ok: boolean; error?: string; already_assigned?: boolean };
      if (!result.ok) throw new Error(result.error || 'Assignment failed');
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-dashboard-overview'] });
      qc.invalidateQueries({ queryKey: ['org-licenses'] });
      qc.invalidateQueries({ queryKey: ['org-seat-members'] });
    },
  });
}

export function useRevokeOrgSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { licenseId: string; userId: string }) => {
      const { data, error } = await supabase.rpc('release_org_license_seat' as any, {
        p_license_id: params.licenseId,
        p_user_id: params.userId,
      });
      if (error) throw error;
      const result = data as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error || 'Release failed');
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-dashboard-overview'] });
      qc.invalidateQueries({ queryKey: ['org-licenses'] });
      qc.invalidateQueries({ queryKey: ['org-seat-members'] });
    },
  });
}
