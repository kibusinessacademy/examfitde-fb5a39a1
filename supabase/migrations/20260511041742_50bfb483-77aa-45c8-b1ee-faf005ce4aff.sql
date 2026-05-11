-- ─────────────────────────────────────────────────────────────
-- Helper: detect mutation signals in an audit artifact
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_growth_artifact_has_mutation_signals(p_artifact jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_keys text[] := ARRAY[
    'mutated','changes','created_assets','updated_records',
    'inserted_rows','deleted_rows','wrote_records','content_mutation'
  ];
  v_k text;
  v_hits text[] := ARRAY[]::text[];
  v_mut jsonb;
BEGIN
  IF p_artifact IS NULL OR jsonb_typeof(p_artifact) <> 'object' THEN
    RETURN jsonb_build_object('mutated', false, 'hits', '[]'::jsonb);
  END IF;

  FOREACH v_k IN ARRAY v_keys LOOP
    IF p_artifact ? v_k THEN
      -- truthy: true / non-zero number / non-empty array / non-empty object / non-empty string
      IF (p_artifact->v_k) IS NOT NULL
         AND (p_artifact->>v_k) NOT IN ('', 'false', '0', 'null', '[]', '{}') THEN
        v_hits := array_append(v_hits, v_k);
      END IF;
    END IF;
  END LOOP;

  -- nested 'mutation' object with any non-zero numeric child
  IF p_artifact ? 'mutation' AND jsonb_typeof(p_artifact->'mutation') = 'object' THEN
    v_mut := p_artifact->'mutation';
    IF EXISTS (
      SELECT 1 FROM jsonb_each(v_mut) e
      WHERE (jsonb_typeof(e.value) = 'number' AND (e.value)::text <> '0')
         OR (jsonb_typeof(e.value) = 'boolean' AND (e.value)::text = 'true')
         OR (jsonb_typeof(e.value) = 'array'   AND jsonb_array_length(e.value) > 0)
    ) THEN
      v_hits := array_append(v_hits, 'mutation');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mutated', array_length(v_hits, 1) IS NOT NULL,
    'hits',    to_jsonb(v_hits)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_growth_artifact_has_mutation_signals(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_growth_artifact_has_mutation_signals(jsonb) TO service_role, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Trigger: hard-block mutation on audit_only modules
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_growth_audit_only_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_signals jsonb;
  v_hits jsonb;
  v_existing_reasons jsonb;
BEGIN
  IF NEW.artifact_ref IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT generator_kind INTO v_kind
  FROM public.growth_repair_modules
  WHERE subscore = NEW.subscore;

  IF v_kind IS DISTINCT FROM 'audit_only' THEN
    RETURN NEW;
  END IF;

  v_signals := public.fn_growth_artifact_has_mutation_signals(NEW.artifact_ref);
  IF NOT (v_signals->>'mutated')::boolean THEN
    RETURN NEW;
  END IF;

  v_hits := v_signals->'hits';

  -- Annotate artifact with the block evidence
  NEW.artifact_ref := NEW.artifact_ref || jsonb_build_object(
    'audit_only_mutation_block', jsonb_build_object(
      'blocked_at', now(),
      'hits', v_hits,
      'reason', 'audit_only_mutation_blocked'
    )
  );

  -- Force rollback status + append reason
  v_existing_reasons := COALESCE(NEW.rollback_info->'reasons', '[]'::jsonb);
  IF NOT (v_existing_reasons @> '["audit_only_mutation_blocked"]'::jsonb) THEN
    v_existing_reasons := v_existing_reasons || '["audit_only_mutation_blocked"]'::jsonb;
  END IF;
  NEW.rollback_info := COALESCE(NEW.rollback_info, '{}'::jsonb) || jsonb_build_object(
    'reasons', v_existing_reasons,
    'at', now(),
    'hits', v_hits
  );
  NEW.status := 'rolled_back';
  NEW.completed_at := COALESCE(NEW.completed_at, now());

  -- Audit (cannot raise here; trigger must be deterministic)
  INSERT INTO public.auto_heal_log (action_type, result_status, target_type, target_id, metadata)
  VALUES (
    'audit_only_mutation_blocked',
    'blocked',
    'growth_repair_run',
    NEW.id,
    jsonb_build_object(
      'subscore', NEW.subscore,
      'package_id', NEW.package_id,
      'hits', v_hits,
      'wave', '5.3'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_growth_audit_only_block_mutation ON public.growth_repair_runs;
CREATE TRIGGER trg_growth_audit_only_block_mutation
BEFORE INSERT OR UPDATE OF artifact_ref, status ON public.growth_repair_runs
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_growth_audit_only_block_mutation();

-- ─────────────────────────────────────────────────────────────
-- Smoke: blocked + clean
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pkg uuid;
  v_run uuid;
  v_status text;
  v_reasons jsonb;
  v_block jsonb;
BEGIN
  SELECT id INTO v_pkg FROM public.course_packages LIMIT 1;
  IF v_pkg IS NULL THEN RAISE NOTICE 'smoke skip: no packages'; RETURN; END IF;

  -- 1) MUTATION ARTIFACT must be blocked
  v_run := public.fn_growth_repair_start_run(v_pkg, 'cta', NULL);
  UPDATE public.growth_repair_runs
  SET artifact_ref = jsonb_build_object(
        'verdict','red',
        'mutated', true,
        'changes', jsonb_build_array('cta_copy'),
        'smoke', 'welle_5_3_mutation_block'
      ),
      status = 'completed'
  WHERE id = v_run;

  SELECT status, rollback_info, artifact_ref->'audit_only_mutation_block'
  INTO v_status, v_reasons, v_block
  FROM public.growth_repair_runs WHERE id = v_run;

  IF v_status <> 'rolled_back'
     OR NOT (v_reasons->'reasons' @> '["audit_only_mutation_blocked"]'::jsonb)
     OR v_block IS NULL THEN
    RAISE EXCEPTION 'audit_only mutation-block FAILED: status=% reasons=% block=%',
      v_status, v_reasons, v_block;
  END IF;

  -- 2) CLEAN ARTIFACT must NOT be blocked by this trigger
  --    (it may still be rolled_back by post_score_unavailable — both states are acceptable
  --     here; the only thing we forbid is the audit_only_mutation_blocked reason.)
  v_run := public.fn_growth_repair_start_run(v_pkg, 'cta', NULL);
  UPDATE public.growth_repair_runs
  SET artifact_ref = jsonb_build_object(
        'verdict','red',
        'campaign_assets', jsonb_build_object('cta_assets', 0),
        'cta_events_30d', jsonb_build_object('visible', 0, 'click', 0),
        'recommended_action', 'check_landing_page_cta_render',
        'smoke', 'welle_5_3_clean'
      )
  WHERE id = v_run;

  SELECT rollback_info INTO v_reasons FROM public.growth_repair_runs WHERE id = v_run;
  IF v_reasons IS NOT NULL
     AND v_reasons->'reasons' @> '["audit_only_mutation_blocked"]'::jsonb THEN
    RAISE EXCEPTION 'clean artifact unexpectedly blocked: %', v_reasons;
  END IF;

  RAISE NOTICE 'welle_5_3 audit_only hard-block smoke OK';
END $$;

INSERT INTO public.auto_heal_log (action_type, result_status, target_type, metadata)
VALUES (
  'welle_5_3_audit_only_hardblock_deployed',
  'completed',
  'system',
  jsonb_build_object(
    'wave', '5.3',
    'trigger', 'trg_growth_audit_only_block_mutation',
    'helper', 'fn_growth_artifact_has_mutation_signals'
  )
);