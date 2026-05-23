-- Architectural Continuity Guard v1.3 — Semantic Runtime Graph Mirror
-- Read-only View, gespiegelt aus src/lib/governance/known-systems.ts (TS = SSOT).
-- Service-role only. Zugriff via SECURITY DEFINER RPC mit has_role-Gate.
-- Pure mirror — kein Write-Pfad, kein zweites SSOT.

CREATE OR REPLACE VIEW public.v_known_systems_semantic_graph AS
SELECT * FROM (
  VALUES
    ('auto_heal_log', 'audit_log', 'audit', 'platform-ops', 'core', 5, true),
    ('ops_guardrail_events', 'audit_log', 'audit', 'platform-ops', 'core', 5, false),
    ('ops_audit_contract', 'registry', 'audit', 'platform-ops', 'core', 5, false),
    ('ops_job_type_registry', 'registry', 'governance', 'platform-ops', 'core', 5, false),
    ('job_queue', 'queue', 'queue', 'platform-ops', 'core', 5, true),
    ('system_intents', 'queue', 'runtime', 'platform-ops', 'core', 5, false),
    ('email_delivery_queue', 'queue', 'marketing', 'marketing-loop-b', 'core', 5, false),
    ('notification_events', 'queue', 'notification', 'marketing-loop-b', 'core', 5, false),
    ('conversion_events', 'table', 'marketing', 'marketing-loop-a', 'core', 5, false),
    ('cta_winner_decisions', 'table', 'marketing', 'marketing-loop-a', 'extension', 5, false),
    ('course_packages', 'table', 'content', 'content-pipeline', 'core', 5, true),
    ('exam_questions', 'table', 'content', 'content-pipeline', 'core', 5, false),
    ('learner_course_grants', 'table', 'license', 'marketing-loop-c', 'core', 5, true),
    ('entitlements', 'table', 'license', 'marketing-loop-c', 'core', 5, false),
    ('seo_content_priority_queue', 'table', 'seo', 'seo-knowledge-os', 'core', 5, false),
    ('admin_seo_wave_enqueue_one', 'rpc', 'seo', 'seo-knowledge-os', 'core', 5, false),
    ('v_seo_content_node_ssot', 'view', 'seo', 'seo-knowledge-os', 'extension', 5, false),
    ('seo_refresh_queue', 'queue', 'seo', 'seo-knowledge-os', 'extension', 5, false),
    ('user_roles', 'table', 'auth', 'platform-ops', 'core', 5, false),
    ('ai-generation-gateway', 'edge_function', 'runtime', 'platform-ops', 'core', 5, false),
    ('fn_emit_audit', 'edge_function', 'audit', 'platform-ops', 'core', 5, false)
) AS t(name, kind, domain, ownership, governance_tier, healability_score, has_drift_signal);

REVOKE ALL ON public.v_known_systems_semantic_graph FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_known_systems_semantic_graph TO service_role;

COMMENT ON VIEW public.v_known_systems_semantic_graph IS
'v1.3 Mirror der TS-Registry src/lib/governance/known-systems.ts. SSOT bleibt TS. Diese View dient ausschließlich SQL-Joins (z.B. Audit-Korrelation auto_heal_log.target_type → known system). Kein Write-Pfad. Aktualisierung via Migration parallel zur TS-Pflege.';

-- Admin-RPC für Read-Zugriff (Audit-Korrelation in zukünftigen Reports)
CREATE OR REPLACE FUNCTION public.admin_get_known_systems_semantic_graph()
RETURNS TABLE(
  name text,
  kind text,
  domain text,
  ownership text,
  governance_tier text,
  healability_score int,
  has_drift_signal boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT name, kind, domain, ownership, governance_tier, healability_score, has_drift_signal
  FROM public.v_known_systems_semantic_graph
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY name;
$$;

REVOKE ALL ON FUNCTION public.admin_get_known_systems_semantic_graph() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_known_systems_semantic_graph() TO authenticated;

COMMENT ON FUNCTION public.admin_get_known_systems_semantic_graph() IS
'v1.3 Read-only Admin-Accessor für v_known_systems_semantic_graph. has_role-Gate.';