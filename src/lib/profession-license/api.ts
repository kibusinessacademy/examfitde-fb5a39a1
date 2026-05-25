/**
 * Global Profession License & Agent Logic — Client API
 * SSOT-Gate für berufsfeld-gebundene Plattform-Logik.
 */
import { supabase } from "@/integrations/supabase/client";

export type LicenseTier = "standard" | "pro" | "enterprise";
export type LicenseStatus = "active" | "locked" | "suspended" | "expired" | "trial";
export type LicenseSource = "included" | "addon" | "enterprise" | "trial";

export type GuardReason =
  | "agent_unknown"
  | "profession_missing"
  | "tier_insufficient"
  | "agent_not_in_profession_context"
  | "agent_category_blocked"
  | "agent_disabled_for_org"
  | "agent_tier_insufficient"
  | null;

export interface GuardResult {
  allowed: boolean;
  reason: GuardReason;
  profession_id: string | null;
  tier: LicenseTier | null;
  agent_id: string | null;
}

export interface ProfessionLicense {
  id: string;
  organization_id: string;
  profession_id: string;
  is_primary: boolean;
  status: LicenseStatus;
  tier: LicenseTier;
  source: LicenseSource;
  activated_at: string;
  expires_at: string | null;
}

export interface OrgAgentRow {
  agent_id: string;
  slug: string;
  name: string;
  category: string;
  enabled: boolean;
  tier_required: LicenseTier;
}

export interface OrgProfessionAccess {
  organization_id: string;
  licenses: ProfessionLicense[];
  agents: OrgAgentRow[];
  primary_context: Record<string, unknown> | null;
}

const sb = supabase as unknown as {
  rpc: (n: string, a?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function checkProfessionAgentAccess(input: {
  organization_id: string;
  agent_slug: string;
  workflow_slug?: string | null;
  profession_id?: string | null;
  required_tier?: LicenseTier;
}): Promise<GuardResult> {
  const { data, error } = await sb.rpc("check_profession_agent_access", {
    _organization_id: input.organization_id,
    _agent_slug: input.agent_slug,
    _workflow_slug: input.workflow_slug ?? null,
    _profession_id: input.profession_id ?? null,
    _required_tier: input.required_tier ?? "standard",
  });
  if (error) throw error;
  return data as GuardResult;
}

export async function getOrgProfessionAccess(organization_id: string): Promise<OrgProfessionAccess> {
  const { data, error } = await sb.rpc("get_organization_profession_access", {
    _organization_id: organization_id,
  });
  if (error) throw error;
  return data as OrgProfessionAccess;
}

export async function adminGrantProfessionLicense(input: {
  organization_id: string;
  profession_id: string;
  is_primary?: boolean;
  tier?: LicenseTier;
  source?: LicenseSource;
  expires_at?: string | null;
}) {
  const { data, error } = await sb.rpc("admin_grant_profession_license", {
    _organization_id: input.organization_id,
    _profession_id: input.profession_id,
    _is_primary: input.is_primary ?? false,
    _tier: input.tier ?? "standard",
    _source: input.source ?? "included",
    _expires_at: input.expires_at ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function adminSetAgentAccess(input: {
  organization_id: string;
  agent_slug: string;
  enabled?: boolean;
  tier_required?: LicenseTier;
}) {
  const { data, error } = await sb.rpc("admin_set_agent_access", {
    _organization_id: input.organization_id,
    _agent_slug: input.agent_slug,
    _enabled: input.enabled ?? true,
    _tier_required: input.tier_required ?? "standard",
  });
  if (error) throw error;
  return data as string;
}

export async function adminUpsertProfessionContext(input: {
  profession_id: string;
  profession_name: string;
  allowed_agent_slugs?: string[];
  allowed_agent_categories?: string[];
  allowed_workflow_categories?: string[];
  governance_profile?: Record<string, unknown>;
}) {
  const { data, error } = await sb.rpc("admin_upsert_profession_context", {
    _profession_id: input.profession_id,
    _profession_name: input.profession_name,
    _allowed_agent_slugs: input.allowed_agent_slugs ?? [],
    _allowed_agent_categories: input.allowed_agent_categories ?? [],
    _allowed_workflow_categories: input.allowed_workflow_categories ?? [],
    _governance_profile: input.governance_profile ?? {},
  });
  if (error) throw error;
  return data as string;
}

export const GUARD_REASON_LABEL: Record<NonNullable<GuardReason>, string> = {
  agent_unknown: "Agent existiert nicht",
  profession_missing: "Kein aktives Berufsfeld lizenziert",
  tier_insufficient: "Tarif reicht nicht aus",
  agent_not_in_profession_context: "Agent gehört nicht zu diesem Berufsfeld",
  agent_category_blocked: "Agent-Kategorie nicht freigegeben",
  agent_disabled_for_org: "Agent für Organisation deaktiviert",
  agent_tier_insufficient: "Agent erfordert höheren Tarif",
};
