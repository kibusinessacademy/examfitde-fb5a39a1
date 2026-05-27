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
