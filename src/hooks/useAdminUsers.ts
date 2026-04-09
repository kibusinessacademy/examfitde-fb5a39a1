import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AdminUser {
  user_id: string;
  email: string;
  display_name: string | null;
  org_name: string | null;
  org_id: string | null;
  role: string | null;
  seat_count: number;
  active_products: string[];
  status: string;
  last_sign_in_at: string | null;
  created_at: string;
  source_type: string;
}

export interface AdminUserDetail {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  memberships: { org_id: string; org_name: string; role: string; created_at: string }[];
  seats: { seat_id: string; license_id: string; product_title: string; claimed_at: string; released_at: string | null }[];
  entitlements: { id: string; product_id: string; product_title: string | null; valid_from: string; valid_until: string | null }[];
}

export function useAdminUsers(filters?: { orgId?: string; role?: string; status?: string; search?: string }) {
  return useQuery({
    queryKey: ['admin-users', filters],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-read-users`);
      if (filters?.orgId) url.searchParams.set('org_id', filters.orgId);
      if (filters?.role) url.searchParams.set('role', filters.role);
      if (filters?.status) url.searchParams.set('status', filters.status);
      if (filters?.search) url.searchParams.set('search', filters.search);

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      return (json.users ?? []) as AdminUser[];
    },
    staleTime: 30_000,
  });
}

export function useAdminUserDetail(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-read-users?user_id=${userId}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      return json.user as AdminUserDetail | null;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}
