/**
 * BerufOS Occupational Intelligence — Reader Lib
 *
 * Thin read-only bridge zur strukturierten Berufs-DNA:
 *   Vertical → Certification-Catalog → Curriculum → Lernfelder → Kompetenzen → Blueprints
 *
 * SSOT bleiben die bestehenden Tabellen. Diese Lib mutiert nichts.
 * Server-Side: View v_vertical_occupational_intelligence + RPC get_vertical_occupational_dna.
 */
import { supabase } from "@/integrations/supabase/client";

export interface VerticalOIRowSummary {
  vertical_slug: string;
  vertical_name: string;
  industry_key: string;
  certifications_count: number;
  curricula_count: number;
  learning_fields_count: number;
  competencies_count: number;
  blueprints_count: number;
}

export interface OICertification {
  id: string;
  slug: string;
  title: string;
  catalog_type: string;
  chamber_type: string;
  recognition_type: string;
  track: string;
  certification_id: string | null;
}

export interface OILearningField {
  code: string;
  title: string;
  weight_percent: number | null;
}

export interface OICurriculum {
  id: string;
  title: string;
  status: string;
  track: string;
  certification_type: string;
  learning_field_count: number;
  competency_count: number;
  learning_fields: OILearningField[];
}

export interface OINamedItem {
  key: string;
  label: string;
  [extra: string]: unknown;
}

export interface VerticalOccupationalDna {
  vertical: {
    id: string;
    vertical_slug: string;
    industry_key: string;
    name: string;
    description: string | null;
    roles: string[];
    kpis: OINamedItem[];
    risks: OINamedItem[];
    pain_points: OINamedItem[];
    sops: unknown;
    regulatory_context: unknown;
    processes: OINamedItem[];
    documents: OINamedItem[];
    workflow_types: OINamedItem[];
    escalations: OINamedItem[];
    outcomes: OINamedItem[];
    persona_seeds: OINamedItem[];
    kpi_models: OINamedItem[];
    communication_models: OINamedItem[];
    decision_models: OINamedItem[];
    document_intelligence: OINamedItem[];
  };
  summary: Partial<Omit<VerticalOIRowSummary, "vertical_slug" | "vertical_name" | "industry_key">>;
  certifications: OICertification[];
  curricula: OICurriculum[];
}

/** Liefert die vollständige strukturierte Berufs-DNA einer Branche. */
export async function getVerticalOccupationalDna(
  verticalSlug: string,
): Promise<VerticalOccupationalDna | null> {
  const { data, error } = await supabase.rpc("get_vertical_occupational_dna", {
    _vertical_slug: verticalSlug,
  });
  if (error) {
    console.warn("[occupational-intelligence] RPC error", error);
    return null;
  }
  if (!data || typeof data !== "object" || (data as { error?: string }).error) {
    return null;
  }
  return data as unknown as VerticalOccupationalDna;
}

// =============================================================================
// VerwaltungsOS — Fachbereichs-DNA v1 (strikt typed, read-only)
// =============================================================================

export interface VerwaltungDepartmentSummary {
  department_key: string;
  department_name: string;
  category: string;
  use_cases_count: number;
  oral_cases_count: number;
}

export interface VDNamedItem {
  key: string;
  label: string;
  [extra: string]: unknown;
}

export interface VDUseCase {
  key: string;
  title: string;
  description?: string;
  outcome?: string;
  risk?: string;
  [extra: string]: unknown;
}

export interface VDOralCase {
  key: string;
  scenario_title: string;
  role_counterpart?: string;
  conflict_level?: "low" | "medium" | "high" | string;
  communication_goal?: string;
  training_focus?: string;
  legal_complexity?: string;
  [extra: string]: unknown;
}

export interface VerwaltungDepartmentDna {
  id: string;
  department_key: string;
  department_name: string;
  category: string;
  vertical_slug: string;
  roles: VDNamedItem[];
  processes: VDNamedItem[];
  documents: VDNamedItem[];
  kpis: VDNamedItem[];
  risks: VDNamedItem[];
  communication_patterns: VDNamedItem[];
  decision_models: VDNamedItem[];
  escalation_paths: VDNamedItem[];
  persona_seeds: VDNamedItem[];
  use_cases: VDUseCase[];
  oral_training_cases: VDOralCase[];
  meta?: Record<string, unknown>;
}

/** Liste aller Verwaltungs-Fachbereiche (read-only, gruppierbar nach KGSt-Cluster). */
export async function listVerwaltungDepartments(): Promise<VerwaltungDepartmentSummary[]> {
  const { data, error } = await supabase.rpc("list_verwaltung_departments");
  if (error) {
    console.warn("[verwaltung-dna] list RPC error", error);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data as unknown as VerwaltungDepartmentSummary[];
}

/** Vollständige Fachbereichs-DNA inkl. Use-Cases + Oral-Training-Szenarien. */
export async function getVerwaltungDepartmentDna(
  departmentKey: string,
): Promise<VerwaltungDepartmentDna | null> {
  const { data, error } = await supabase.rpc("get_verwaltung_department_dna", {
    _department_key: departmentKey,
  });
  if (error) {
    console.warn("[verwaltung-dna] detail RPC error", error);
    return null;
  }
  if (!data || typeof data !== "object" || (data as { error?: string }).error) {
    return null;
  }
  return data as unknown as VerwaltungDepartmentDna;
}

// =============================================================================
// VerwaltungsOS — DailyBrief v1 (read-only Governance Intelligence)
// =============================================================================

export interface VDailyBriefScores {
  buergerverstaendlichkeit: number | null;
  deeskalation: number | null;
  governance_sicherheit: number | null;
  empathie: number | null;
  fachlichkeit: number | null;
}

export interface VDailyBriefSignals {
  sessions_24h: number;
  sessions_7d: number;
  sessions_30d: number;
  avg_escalation: number | null;
  max_escalation: number | null;
  high_conflict_pct: number | null;
  finalized_sessions: number;
  scores: VDailyBriefScores;
  top_emotions: Record<string, number> | null;
  top_personas: Array<{ persona: string; count: number }> | null;
}

export interface VDailyBriefDepartment {
  department_key: string;
  department_name: string;
  category: string;
  window_days: number;
  signals: VDailyBriefSignals;
  weakest_dimension: { label: string; score: number };
  kpis: VDNamedItem[];
  risks: VDNamedItem[];
  communication_patterns: VDNamedItem[];
  escalation_paths: VDNamedItem[];
  recommendation: string;
  generated_at: string;
}

export interface VDailyBriefExecutive {
  window_days: number;
  totals: {
    sessions_24h: number;
    sessions_7d: number;
    avg_escalation: number | null;
    avg_high_conflict_pct: number | null;
  };
  clusters: Array<{
    category: string;
    departments_active: number;
    sessions_7d: number | null;
    avg_escalation: number | null;
    high_conflict_pct: number | null;
  }>;
  hotspots: Array<{
    department_key: string;
    department_name: string;
    category: string;
    sessions_7d: number;
    avg_escalation: number | null;
    high_conflict_pct: number | null;
    weakest_score: number | null;
  }>;
  generated_at: string;
}

export interface VDailyBriefGovernanceRisks {
  window_days: number;
  risks: Array<{
    department_key: string;
    department_name: string;
    category: string;
    risk_type: string;
    sessions_7d: number;
    avg_escalation: number | null;
    high_conflict_pct: number | null;
    scores: Partial<VDailyBriefScores>;
  }>;
  generated_at: string;
}

export async function getVerwaltungDailyBriefDepartment(
  departmentKey: string,
  windowDays = 7,
): Promise<VDailyBriefDepartment | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("verwaltung_daily_brief_department", {
    _department_key: departmentKey,
    _window_days: windowDays,
  });
  if (error || !data || (data as { error?: string }).error) return null;
  return data as VDailyBriefDepartment;
}

export async function getVerwaltungDailyBriefExecutive(
  windowDays = 7,
): Promise<VDailyBriefExecutive | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("verwaltung_daily_brief_executive", {
    _window_days: windowDays,
  });
  if (error || !data || (data as { error?: string }).error) return null;
  return data as VDailyBriefExecutive;
}

export async function getVerwaltungDailyBriefGovernanceRisks(
  windowDays = 7,
): Promise<VDailyBriefGovernanceRisks | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "verwaltung_daily_brief_governance_risks",
    { _window_days: windowDays },
  );
  if (error || !data || (data as { error?: string }).error) return null;
  return data as VDailyBriefGovernanceRisks;
}

// =============================================================================
// VerwaltungsOS — Reality-Bridge v1 (DNA × Oral × Arbeitsmarkt)
// =============================================================================

export interface VRealityDepartment {
  department_key: string;
  department_name: string;
  category: string;
  market_query: string | null;
  oral_sessions: number;
  avg_escalation: number;
  high_conflict_pct: number;
  use_case_count: number;
  oral_case_count: number;
  reality_priority: "HIGH" | "MEDIUM" | "LOW" | "IDLE";
}

export interface VRealityBridge {
  window_days: number;
  generated_at: string;
  departments: VRealityDepartment[];
}

/** DailyBrief Reality-Bridge — admin-gated, server-aggregiert. */
export async function getVerwaltungDailyBriefRealityBridge(
  windowDays = 7,
  limit = 20,
): Promise<VRealityBridge | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "verwaltung_daily_brief_reality_bridge",
    { _window_days: windowDays, _limit: limit },
  );
  if (error || !data || (data as { error?: string }).error) return null;
  return data as VRealityBridge;
}

export interface VRealityJobsSummary {
  total: number;
  trend_7d: number;
  trend_14d: number;
  trend_30d: number;
  top_arbeitgeber: { name: string; count: number }[];
  top_orte: { name: string; count: number }[];
  fetched_at: string;
  source: string;
  market_query: string;
}

/** Live BA-Jobsuche-Aggregat (Pass-Through zur Edge `verwaltung-arbeitsmarkt`). */
export async function getVerwaltungLiveJobsForQuery(
  marketQuery: string,
): Promise<VRealityJobsSummary | null> {
  if (!marketQuery || marketQuery.length < 2) return null;
  const { data, error } = await supabase.functions.invoke("verwaltung-arbeitsmarkt", {
    body: { was: marketQuery, size: 25 },
  });
  if (error || !data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  if (!d.aggregation) return null;
  return {
    total: d.aggregation.total ?? 0,
    trend_7d: d.aggregation.trend?.last_7_days ?? 0,
    trend_14d: d.aggregation.trend?.last_14_days ?? 0,
    trend_30d: d.aggregation.trend?.last_30_days ?? 0,
    top_arbeitgeber: (d.aggregation.top_arbeitgeber ?? []).slice(0, 5),
    top_orte: (d.aggregation.top_orte ?? []).slice(0, 5),
    fetched_at: d.fetched_at ?? new Date().toISOString(),
    source: d.source ?? "BA_JOBSUCHE",
    market_query: marketQuery,
  };
}

// =============================================================================
// VerwaltungsOS — Executive Cockpit v1 (server-aggregierter Premium-Payload)
// =============================================================================

export interface VExecutiveCockpit {
  window_days: number;
  generated_at: string;
  executive: VDailyBriefExecutive | null;
  risks: VDailyBriefGovernanceRisks | null;
  reality: VRealityBridge | null;
}

/** Executive Cockpit — admin-gated, eine Server-Aggregation für DailyBrief + Risks + Reality. */
export async function getVerwaltungExecutiveCockpit(
  windowDays = 7,
): Promise<VExecutiveCockpit | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("verwaltung_executive_cockpit", {
    _window_days: windowDays,
  });
  if (error || !data || (data as { error?: string }).error) return null;
  return data as VExecutiveCockpit;
}





