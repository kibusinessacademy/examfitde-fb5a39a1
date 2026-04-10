import { supabase } from "@/integrations/supabase/client";

async function getJwt() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

function apiBase() {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
}

async function fetchJson(path: string, init?: RequestInit) {
  const jwt = await getJwt();
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

// ─── Org Console Context ───────────────────────────────────────
export async function getOrgConsoleContext(organization_id?: string) {
  const q = organization_id ? `?organization_id=${encodeURIComponent(organization_id)}` : "";
  return fetchJson(`/get-org-console-context${q}`, { method: "GET" });
}

// ─── School Dashboard ──────────────────────────────────────────
export async function getSchoolDashboard(organization_id: string) {
  const sp = new URLSearchParams({ organization_id });
  return fetchJson(`/get-school-dashboard?${sp.toString()}`, { method: "GET" });
}

// ─── School Class Detail ───────────────────────────────────────
export async function getSchoolClassDetail(class_id: string) {
  const sp = new URLSearchParams({ class_id });
  return fetchJson(`/get-school-class-detail?${sp.toString()}`, { method: "GET" });
}

// ─── Institution Dashboard (IHK/HWK) ──────────────────────────
export async function getInstitutionDashboard(organization_id: string) {
  const sp = new URLSearchParams({ organization_id });
  return fetchJson(`/get-institution-dashboard?${sp.toString()}`, { method: "GET" }) as Promise<{
    org: { id: string; name: string; org_type: string };
    kpis: {
      linked_schools_count: number;
      linked_companies_count: number;
      active_curricula_count: number;
      active_classes_count: number;
      active_learners_count: number;
      avg_readiness_score: number;
      high_risk_count: number;
    };
    linked_orgs: {
      schools: Array<{ org_id: string; name: string; org_type: string; link_type: string }>;
      companies: Array<{ org_id: string; name: string; org_type: string; link_type: string }>;
    };
    curricula: Array<{
      curriculum_id: string;
      title: string | null;
      active_classes: number;
      active_learners: number;
      avg_readiness_score: number;
    }>;
    risk_distribution: { high: number; medium: number; low: number; not_started: number };
    recent_activity: { active_last_7_days: number; active_last_14_days: number; inactive_over_14_days: number };
  }>;
}

// ─── Org Links ─────────────────────────────────────────────────
export async function getOrgLinks(organization_id: string) {
  const sp = new URLSearchParams({ organization_id });
  return fetchJson(`/get-org-links?${sp.toString()}`, { method: "GET" });
}

// ─── KPIs ──────────────────────────────────────────────────────
export async function getOrgKpis(params: {
  organization_id: string;
  mode?: "fiscal_year" | "calendar_year" | "range";
  year?: number;
  start_date?: string;
  end_date?: string;
  scope?: "ANONYMIZED" | "PSEUDONYMIZED" | "IDENTIFIED";
  entity_id?: string;
}) {
  const sp = new URLSearchParams({ organization_id: params.organization_id });
  if (params.mode) sp.set("mode", params.mode);
  if (params.year) sp.set("year", String(params.year));
  if (params.start_date) sp.set("start_date", params.start_date);
  if (params.end_date) sp.set("end_date", params.end_date);
  if (params.scope) sp.set("scope", params.scope);
  if (params.entity_id) sp.set("entity_id", params.entity_id);
  return fetchJson(`/get-org-kpis?${sp.toString()}`, { method: "GET" });
}

// ─── Billing ───────────────────────────────────────────────────
export async function getOrgBillingContext(params: {
  organization_id: string;
  page?: number;
  page_size?: number;
  invoice_status?: string;
  entity_id?: string;
  billing_account_id?: string;
}) {
  const sp = new URLSearchParams({ organization_id: params.organization_id });
  if (params.page) sp.set("page", String(params.page));
  if (params.page_size) sp.set("page_size", String(params.page_size));
  if (params.invoice_status) sp.set("invoice_status", params.invoice_status);
  if (params.entity_id) sp.set("entity_id", params.entity_id);
  if (params.billing_account_id) sp.set("billing_account_id", params.billing_account_id);
  return fetchJson(`/get-org-billing-context?${sp.toString()}`, { method: "GET" });
}

// ─── Invoice Coding ────────────────────────────────────────────
export async function setOrgInvoiceCoding(payload: {
  organization_id: string;
  invoice_id: string;
  entity_id?: string | null;
  cost_center?: string | null;
  cost_object?: string | null;
  gl_account?: string | null;
  project_code?: string | null;
  internal_ref?: string | null;
  notes?: string | null;
}) {
  return fetchJson(`/set-org-invoice-coding`, { method: "POST", body: JSON.stringify(payload) });
}

// ─── Privacy Access ────────────────────────────────────────────
export async function requestIdentifiedAccess(payload: {
  organization_id: string;
  scope: "IDENTIFIED";
  reason?: string;
}) {
  return fetchJson(`/request-identified-access`, { method: "POST", body: JSON.stringify(payload) });
}

// ─── Entities ──────────────────────────────────────────────────
export async function getOrgEntities(params: { organization_id: string }) {
  const sp = new URLSearchParams({ organization_id: params.organization_id });
  return fetchJson(`/get-org-entities?${sp.toString()}`, { method: "GET" });
}

export async function upsertOrgEntity(payload: {
  organization_id: string;
  id?: string;
  entity_code: string;
  legal_name: string;
  display_name: string;
  vat_id?: string | null;
  billing_email?: string | null;
  is_default?: boolean;
}) {
  return fetchJson(`/upsert-org-entity`, { method: "POST", body: JSON.stringify(payload) });
}

export async function upsertOrgEntityDefaults(payload: {
  entity_id: string;
  default_cost_center?: string | null;
  default_cost_object?: string | null;
  default_gl_account?: string | null;
  default_project_code?: string | null;
}) {
  return fetchJson(`/upsert-org-entity-defaults`, { method: "POST", body: JSON.stringify(payload) });
}

// ─── Admin Privacy ─────────────────────────────────────────────
export async function adminListPrivacyRequests(params?: { status?: string }) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  const q = sp.toString() ? `?${sp.toString()}` : "";
  return fetchJson(`/admin-list-privacy-requests${q}`, { method: "GET" });
}

export async function adminPrivacyDecision(payload: {
  organization_id: string;
  decision: "APPROVE" | "DENY" | "REVOKE";
  days?: number;
  admin_notes?: string;
}) {
  return fetchJson(`/admin-org-privacy-decision`, { method: "POST", body: JSON.stringify(payload) });
}
