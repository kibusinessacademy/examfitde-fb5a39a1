/**
 * React Query hooks for the B2B Org Console.
 * All hooks scope to a single orgId; queries are gated by manager RPC role-checks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listOrgMembers,
  listOrgInvites,
  updateOrgMemberRole,
  createOrgInvite,
  revokeOrgInvite,
  type OrgMemberRow,
  type OrgInviteRow,
} from "@/lib/orgConsoleApi";
import { supabase } from "@/integrations/supabase/client";

export function useOrgMembers(orgId: string | null | undefined) {
  return useQuery<OrgMemberRow[]>({
    queryKey: ["org-members", orgId],
    queryFn: () => (orgId ? listOrgMembers(orgId) : Promise.resolve([])),
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useOrgInvites(orgId: string | null | undefined) {
  return useQuery<OrgInviteRow[]>({
    queryKey: ["org-invites", orgId],
    queryFn: () => (orgId ? listOrgInvites(orgId) : Promise.resolve([])),
    enabled: !!orgId,
    staleTime: 15_000,
  });
}

export function useUpdateOrgMemberRole(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; newRole: "owner" | "admin" | "manager" | "learner" }) => {
      if (!orgId) throw new Error("NO_ORG_ID");
      return updateOrgMemberRole(orgId, vars.userId, vars.newRole);
    },
    onSuccess: (res) => {
      if (!res.ok) throw new Error(res.error || "UPDATE_FAILED");
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
  });
}

export function useCreateOrgInvite(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { licenseId: string; email: string; role?: string }) => {
      if (!orgId) throw new Error("NO_ORG_ID");
      return createOrgInvite({ orgId, ...vars });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
  });
}

export function useRevokeOrgInvite(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => revokeOrgInvite(inviteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
  });
}

export function useRemoveOrgMember(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      if (!orgId) throw new Error("NO_ORG_ID");
      // Soft-remove: status='removed' (reuses existing schema, no destructive delete)
      const { error } = await (supabase as any)
        .from("org_memberships")
        .update({ status: "removed", updated_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("user_id", userId);
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
  });
}
