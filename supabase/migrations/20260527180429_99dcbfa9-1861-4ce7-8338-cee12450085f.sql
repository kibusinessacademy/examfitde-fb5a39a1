ALTER TABLE public.vertical_dna
  ADD COLUMN IF NOT EXISTS kpi_models           JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS communication_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decision_models      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS document_intelligence JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vertical_dna.kpi_models IS
  'Strukturierte KPI-Modelle: {key,label,type:sla|risk|quality|outcome,target,unit,description}';
COMMENT ON COLUMN public.vertical_dna.communication_models IS
  'Kommunikations-Muster: {key,label,scenario,participants[],tone,escalation_to,risk_level}';
COMMENT ON COLUMN public.vertical_dna.decision_models IS
  'Entscheidungs-Modelle: {key,label,decision_type:approval|prioritization|risk|governance,inputs[],stakeholders[],deciding_role}';
COMMENT ON COLUMN public.vertical_dna.document_intelligence IS
  'Dokument-Intelligenz: {key,document_label,required_fields[],common_errors[],validation_rules[],governance_relevance}';