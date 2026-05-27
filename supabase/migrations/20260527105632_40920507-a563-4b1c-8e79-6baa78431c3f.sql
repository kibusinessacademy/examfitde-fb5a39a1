-- Lock down base table SELECT to admins only (admin_all policy already covers admins via ALL).
DROP POLICY IF EXISTS dat_select ON public.document_agent_templates;

-- Public-safe view: excludes system_prompt and user_prompt_template
CREATE OR REPLACE VIEW public.document_agent_templates_public
WITH (security_invoker = on) AS
SELECT
  id, slug, title, description, document_type, category, profession_id,
  curriculum_id, required_inputs, optional_inputs, output_sections,
  compliance_rules, risk_level, review_required, tier_required,
  model_recommendation, is_active, version, created_at, updated_at
FROM public.document_agent_templates
WHERE is_active = true OR public.has_role(auth.uid(), 'admin'::public.app_role);

GRANT SELECT ON public.document_agent_templates_public TO authenticated;
REVOKE ALL ON public.document_agent_templates_public FROM anon;