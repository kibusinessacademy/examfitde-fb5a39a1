-- VerwaltungsAgentOS v1 — Smoke RPC + Audit Contract Registration

CREATE OR REPLACE FUNCTION public._smoke_verwaltung_agent_shape(_department_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dna jsonb;
  v_count integer;
BEGIN
  IF current_user <> 'service_role' AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  SELECT to_jsonb(d.*) INTO v_dna
    FROM verwaltung_department_dna d WHERE d.department_key = _department_key;
  SELECT COUNT(*) INTO v_count
    FROM verwaltung_agent_workflows w
    WHERE w.department_key = _department_key AND w.is_active = true;
  RETURN jsonb_build_object(
    'department_key', _department_key,
    'dna_present', v_dna IS NOT NULL,
    'workflow_count', COALESCE(v_count,0),
    'has_required_categories',
      (SELECT bool_and(c = ANY(SELECT DISTINCT category FROM verwaltung_agent_workflows
                              WHERE department_key=_department_key AND is_active=true))
       FROM unnest(ARRAY['process','communication','governance']) AS c),
    'sample_keys', (SELECT jsonb_agg(workflow_key) FROM verwaltung_agent_workflows
                    WHERE department_key=_department_key AND is_active=true)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._smoke_verwaltung_agent_shape(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._smoke_verwaltung_agent_shape(text) FROM anon;
REVOKE ALL ON FUNCTION public._smoke_verwaltung_agent_shape(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._smoke_verwaltung_agent_shape(text) TO service_role;

-- Audit contract for Strict-RAG runtime (every answer must cite >=1 source)
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'verwaltung_agent_run',
  ARRAY['department_key','workflow_keys','question_hash','sources_count'],
  'verwaltung_agent_os'
)
ON CONFLICT (action_type) DO NOTHING;