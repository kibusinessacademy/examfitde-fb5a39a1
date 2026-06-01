/**
 * Org Console API — thin wrappers around SECURITY DEFINER RPCs for B2B
 * organization management (members, invites, role updates, seat assignment).
 *
 * All RPCs are manager-gated via is_org_member_with_role().
 */
import { supabase } from "@/integrations/supabase/client";

export interface OrgMemberRow {
  membership_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: "owner" | "admin" | "manager" | "learner";
  status: "active" | "invited" | "suspended" | "removed";
  joined_at: string | null;
  source_type: string | null;
  seats_count: number;
}

export interface OrgInviteRow {
  id: string;
  license_id: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  invite_token: string;
  invited_by: string | null;
  invited_by_email: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  product_title: string | null;
}

export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const { data, error } = await supabase.rpc("list_org_members" as any, { p_org_id: orgId });
  if (error) throw error;
  return (data ?? []) as OrgMemberRow[];
}

export async function listOrgInvites(orgId: string): Promise<OrgInviteRow[]> {
  const { data, error } = await supabase.rpc("list_org_invites" as any, { p_org_id: orgId });
  if (error) throw error;
  return (data ?? []) as OrgInviteRow[];
}

export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  newRole: "owner" | "admin" | "manager" | "learner"
): Promise<{ ok: boolean; error?: string; old_role?: string; new_role?: string }> {
  const { data, error } = await supabase.rpc("update_org_member_role" as any, {
    p_org_id: orgId,
    p_user_id: userId,
    p_new_role: newRole,
  });
  if (error) throw error;
  return data as any;
}

export async function createOrgInvite(args: {
  licenseId: string;
  orgId: string;
  email: string;
  role?: string;
}): Promise<{ ok: boolean; error?: string; invite_id?: string; invite_token?: string }> {
  const { data, error } = await supabase.rpc("create_org_license_invite" as any, {
    p_license_id: args.licenseId,
    p_org_id: args.orgId,
    p_email: args.email,
    p_role: args.role ?? "member",
  });
  if (error) throw error;
  return data as any;
}

export async function revokeOrgInvite(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("revoke_org_invite" as any, { p_invite_id: inviteId });
  if (error) throw error;
  return data as any;
}

export async function acceptOrgInvite(token: string): Promise<{ ok: boolean; error?: string; org_id?: string }> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) throw new Error("NOT_AUTHENTICATED");
  const { data, error } = await supabase.rpc("accept_org_license_invite" as any, {
    p_invite_token: token,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as any;
}

export function buildInviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/org/einladung/${token}`;
}
