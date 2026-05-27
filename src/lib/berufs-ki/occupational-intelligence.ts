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

