/**
 * BK-Act-5.1 — Org Structure Foundation (SSOT client).
 *
 * Thin wrappers around manager-gated SECURITY DEFINER RPCs:
 *   - org_structure_list
 *   - org_site_upsert
 *   - org_cohort_upsert
 *   - org_member_assignment_upsert
 *
 * Read-side returns sites/departments/cohorts/reporting_units +
 * the caller's effective scope (fn_org_user_scope).
 */
import { supabase } from "@/integrations/supabase/client";

export type ScopedRole =
  | "learner"
  | "ausbilder"
  | "standortleiter"
  | "bereichsleiter"
  | "hr"
  | "executive"
  | "manager_readonly";

export interface OrgSite {
  id: string;
  org_id: string;
  site_key: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  is_active: boolean;
}

export interface OrgDepartment {
  id: string;
  org_id: string;
  site_id: string | null;
  department_key: string;
  name: string;
  parent_department_id: string | null;
  is_active: boolean;
}

export interface OrgCohort {
  id: string;
  org_id: string;
  site_id: string | null;
  department_id: string | null;
  cohort_key: string;
  name: string;
  profession_key: string | null;
  start_year: number | null;
  exam_window: string | null;
  training_year: number | null;
  risk_band: string | null;
  recovery_band: string | null;
  is_active: boolean;
}

export interface OrgReportingUnit {
  id: string;
  org_id: string;
  unit_key: string;
  name: string;
  unit_type: "site" | "department" | "cohort" | "profession" | "custom";
  description: string | null;
  is_active: boolean;
}

export interface OrgUserScope {
  org_id: string;
  user_id: string;
  membership_role: string | null;
  has_full_org_scope: boolean;
  scoped_roles: ScopedRole[];
  site_ids: string[];
  department_ids: string[];
  cohort_ids: string[];
  reporting_unit_ids: string[];
}

export interface OrgStructure {
  sites: OrgSite[];
  departments: OrgDepartment[];
  cohorts: OrgCohort[];
  reporting_units: OrgReportingUnit[];
  scope: OrgUserScope;
}

export async function fetchOrgStructure(orgId: string): Promise<OrgStructure | null> {
  const { data, error } = await supabase.rpc("org_structure_list" as any, { _org_id: orgId });
  if (error) {
    console.error("[orgStructure] list error", error);
    return null;
  }
  return data as OrgStructure;
}

export async function upsertSite(input: {
  orgId: string;
  siteKey: string;
  name: string;
  city?: string | null;
  region?: string | null;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc("org_site_upsert" as any, {
    _org_id: input.orgId,
    _site_key: input.siteKey,
    _name: input.name,
    _city: input.city ?? null,
    _region: input.region ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function upsertCohort(input: {
  orgId: string;
  cohortKey: string;
  name: string;
  professionKey?: string | null;
  startYear?: number | null;
  examWindow?: string | null;
  trainingYear?: number | null;
  siteId?: string | null;
  departmentId?: string | null;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc("org_cohort_upsert" as any, {
    _org_id: input.orgId,
    _cohort_key: input.cohortKey,
    _name: input.name,
    _profession_key: input.professionKey ?? null,
    _start_year: input.startYear ?? null,
    _exam_window: input.examWindow ?? null,
    _training_year: input.trainingYear ?? null,
    _site_id: input.siteId ?? null,
    _department_id: input.departmentId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function assignMember(input: {
  orgId: string;
  userId: string;
  scopedRole: ScopedRole;
  siteId?: string | null;
  departmentId?: string | null;
  cohortId?: string | null;
  reportingUnitId?: string | null;
  isPrimary?: boolean;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc("org_member_assignment_upsert" as any, {
    _org_id: input.orgId,
    _user_id: input.userId,
    _scoped_role: input.scopedRole,
    _site_id: input.siteId ?? null,
    _department_id: input.departmentId ?? null,
    _cohort_id: input.cohortId ?? null,
    _reporting_unit_id: input.reportingUnitId ?? null,
    _is_primary: input.isPrimary ?? false,
  });
  if (error) throw error;
  return data as string;
}
