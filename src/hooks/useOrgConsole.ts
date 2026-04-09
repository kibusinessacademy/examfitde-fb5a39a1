import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getOrgConsoleContext } from '@/lib/orgApi';

export interface OrgContext {
  org: { id: string; name: string; org_type: string } | null;
  my_role: string | null;
  entities: any[];
  members: any[];
  learners: any[];
  seats: any[];
  seat_summary: Record<string, number>;
  privacy_access: { status: string; scope: string };
}

export interface OrgListItem {
  id: string;
  name: string;
  org_type: string;
  my_role: string;
}

export function useOrgConsoleContext(orgId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['org-console-context', orgId, user?.id],
    queryFn: async () => {
      const data = await getOrgConsoleContext(orgId);
      return data as {
        orgs: OrgListItem[];
        selected: OrgContext | null;
      };
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

/** Org audit events via server-side RPC (no direct table read) */
export function useOrgAuditEvents(orgId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['org-audit-events', orgId, user?.id],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc('get_org_audit_events', {
        p_org_id: orgId,
        p_limit: 100,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!user,
    staleTime: 30_000,
  });
}

/** Check if user has org console access (OWNER, MANAGER, IT_ADMIN, BILLING) */
export function useHasOrgAccess() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['has-org-access', user?.id],
    queryFn: async () => {
      if (!user) return { hasAccess: false, orgs: [] as OrgListItem[] };
      const data = await getOrgConsoleContext();
      const orgs = (data?.orgs || []) as OrgListItem[];
      const managementRoles = ['OWNER', 'MANAGER', 'IT_ADMIN', 'BILLING'];
      const accessibleOrgs = orgs.filter(o => managementRoles.includes(o.my_role));
      return { hasAccess: accessibleOrgs.length > 0, orgs: accessibleOrgs };
    },
    enabled: !!user,
    staleTime: 60_000 * 5,
  });
}
