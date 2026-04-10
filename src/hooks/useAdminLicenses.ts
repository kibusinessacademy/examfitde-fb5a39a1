import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AdminLicense {
  license_id: string;
  org_id: string;
  org_name: string | null;
  product_id: string;
  product_title: string | null;
  seats_total: number;
  seats_used: number;
  seats_available: number;
  starts_at: string;
  ends_at: string | null;
  status: string;
  contract_ref: string | null;
}

export interface AdminSeatAssignment {
  seat_id: string;
  license_id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  product_title: string | null;
  org_name: string | null;
  claimed_at: string;
  released_at: string | null;
  status: string;
}

export interface AdminOrganization {
  org_id: string;
  name: string;
  org_type: string | null;
  member_count: number;
  active_licenses: number;
  total_seats: number;
  used_seats: number;
  created_at: string;
  is_active: boolean;
}

export function useAdminLicenses() {
  return useQuery({
    queryKey: ['admin-licenses'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-enterprise-data?type=licenses`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return (await res.json()).data as AdminLicense[];
    },
    staleTime: 30_000,
  });
}

export function useAdminSeatAssignments() {
  return useQuery({
    queryKey: ['admin-seat-assignments'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-enterprise-data?type=seats`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return (await res.json()).data as AdminSeatAssignment[];
    },
    staleTime: 30_000,
  });
}

export function useAdminOrganizations() {
  return useQuery({
    queryKey: ['admin-organizations'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-enterprise-data?type=organizations`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return (await res.json()).data as AdminOrganization[];
    },
    staleTime: 30_000,
  });
}

export function useAdminAssignSeat() {
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
      toast.success('Seat zugewiesen');
      qc.invalidateQueries({ queryKey: ['admin-licenses'] });
      qc.invalidateQueries({ queryKey: ['admin-seat-assignments'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e: Error) => toast.error(`Seat-Zuweisung fehlgeschlagen: ${e.message}`),
  });
}

export function useAdminRevokeSeat() {
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
      toast.success('Seat entzogen');
      qc.invalidateQueries({ queryKey: ['admin-licenses'] });
      qc.invalidateQueries({ queryKey: ['admin-seat-assignments'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e: Error) => toast.error(`Seat-Entzug fehlgeschlagen: ${e.message}`),
  });
}
