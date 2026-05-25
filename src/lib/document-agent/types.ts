/**
 * Berufs-KI Dokumenten-Agent — Types (SSOT).
 * Erweiterung der Berufs-KI-Linie um Dokumente, nutzt eigene Tabellen
 * und bridged via Knowledge-Graph + profession_contexts.
 */

export type DocRisk = "low" | "medium" | "high";
export type DocTier = "free" | "pro" | "business";
export type DocStatus =
  | "draft"
  | "generating"
  | "generated"
  | "needs_review"
  | "approved"
  | "exported"
  | "archived"
  | "failed";

export interface DocField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  options?: string[];
  help?: string;
}

export interface DocTemplate {
  id: string;
  slug: string;
  title: string;
  description: string;
  document_type: string;
  category: string;
  profession_id: string | null;
  required_inputs: DocField[];
  optional_inputs: DocField[];
  output_sections: string[];
  compliance_rules: Record<string, unknown>;
  risk_level: DocRisk;
  review_required: boolean;
  tier_required: DocTier;
  model_recommendation: string;
  is_active: boolean;
  version: number;
}

export interface DocProfile {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  profession_id: string | null;
  company_name: string;
  legal_name?: string | null;
  address?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  website?: string | null;
  logo_url?: string | null;
  brand_colors: Record<string, string>;
  default_sender_name?: string | null;
  default_sender_role?: string | null;
  default_signature?: string | null;
  tone_of_voice: string;
  compliance_level: "standard" | "sensitive" | "regulated";
  is_default: boolean;
}

export interface DocRunResult {
  run_id: string;
  status: DocStatus;
  review_required: boolean;
  generated_document: string;
  sections: string[];
  compliance_warnings: Array<{ code: string; message: string }>;
  quality_score: number;
  model_used: string;
}
