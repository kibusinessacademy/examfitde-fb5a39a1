import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  getOrgConsoleContext,
  getSchoolDashboard,
  getSchoolClassDetail,
  getInstitutionDashboard,
  getOrgLinks,
} from '@/lib/orgApi';

// ─── Types ─────────────────────────────────────────────────────

export interface OrgContext {
  org: { id: string; name: string; org_type: string; parent_org_id?: string | null } | null;
  my_role: string | null;
  capabilities: Record<string, boolean>;
  summary: {
    active_members: number;
    active_learners: number;
    active_seats: number;
    inactive_seats: number;
    classes_count: number;
    instructors_count: number;
    linked_orgs_count: number;
    curricula_count: number;
  };
  privacy_access: { status: string; scope: string; approved_until?: string | null; requested_at?: string | null };
  linked_orgs: any[];
}

export interface OrgListItem {
  id: string;
  name: string;
  org_type: string;
  parent_org_id?: string | null;
  my_role: string;
}

// ─── Core Org Console Context ──────────────────────────────────

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

// ─── School Dashboard ──────────────────────────────────────────

export function useSchoolDashboard(orgId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['school-dashboard', orgId, user?.id],
    queryFn: async () => {
      if (!orgId) return null;
      return getSchoolDashboard(orgId);
    },
    enabled: !!orgId && !!user,
    staleTime: 60_000,
  });
}

// ─── School Class Detail ───────────────────────────────────────

export function useSchoolClassDetail(classId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['school-class-detail', classId, user?.id],
    queryFn: async () => {
      if (!classId) return null;
      return getSchoolClassDetail(classId);
    },
    enabled: !!classId && !!user,
    staleTime: 60_000,
  });
}

// ─── Institution Dashboard (IHK/HWK) ──────────────────────────

export function useInstitutionDashboard(orgId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['institution-dashboard', orgId, user?.id],
    queryFn: async () => {
      if (!orgId) return null;
      return getInstitutionDashboard(orgId);
    },
    enabled: !!orgId && !!user,
    staleTime: 60_000,
  });
}

// ─── Org Links ─────────────────────────────────────────────────

export function useOrgLinks(orgId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['org-links', orgId, user?.id],
    queryFn: async () => {
      if (!orgId) return { links: [] };
      return getOrgLinks(orgId);
    },
    enabled: !!orgId && !!user,
    staleTime: 60_000,
  });
}

// ─── Audit Events ──────────────────────────────────────────────

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

// ─── Access Check ──────────────────────────────────────────────

export function useHasOrgAccess() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['has-org-access', user?.id],
    queryFn: async () => {
      if (!user) return { hasAccess: false, orgs: [] as OrgListItem[] };
      const data = await getOrgConsoleContext();
      const orgs = (data?.orgs || []) as OrgListItem[];
      const managementRoles = ['OWNER', 'MANAGER', 'IT_ADMIN', 'BILLING', 'SCHOOL_ADMIN', 'IHK_ADMIN', 'HWK_ADMIN', 'INSTRUCTOR'];
      const accessibleOrgs = orgs.filter(o => managementRoles.includes(o.my_role));
      return { hasAccess: accessibleOrgs.length > 0, orgs: accessibleOrgs };
    },
    enabled: !!user,
    staleTime: 60_000 * 5,
  });
}
