
-- ============================================================
-- SSOT Producer Hardening v1.2 — Trigger-Reattach + DLQ + Dashboard-RPCs
-- 2026-05-02
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1) DEAD-LETTER QUEUE
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_queue_dead_letter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  package_id uuid,
  curriculum_id uuid,
  payload jsonb,
  meta jsonb,
  violations text[],
  blocked_at timestamptz NOT NULL DEFAULT now(),
  source text,
  -- Forensik
  job_intended_id uuid,
  resolution text DEFAULT 'pending', -- pending|requeued|discarded
  resolved_at timestamptz,
  resolved_by text
);

CREATE INDEX IF NOT EXISTS idx_jq_dlq_blocked_at ON public.job_queue_dead_letter(blocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_jq_dlq_job_type   ON public.job_queue_dead_letter(job_type);
CREATE INDEX IF NOT EXISTS idx_jq_dlq_resolution ON public.job_queue_dead_letter(resolution);

ALTER TABLE public.job_queue_dead_letter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access dlq" ON public.job_queue_dead_letter;
CREATE POLICY "service_role full access dlq"
  ON public.job_queue_dead_letter
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admin read dlq" ON public.job_queue_dead_letter;
CREATE POLICY "admin read dlq"
  ON public.job_queue_dead_letter
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ──────────────────────────────────────────────────────────
-- 2) ERWEITERTE TRIGGER-FUNKTION v1.2
--    + violations_detail (job_id, missing_fields, auto_derived, producer_hint)
--    + Dead-Letter-Insert bei Hard-Block
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_job_queue_ssot_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enforce_at timestamptz := '2026-05-09 00:00:00+00'::timestamptz;
  v_enforce boolean := now() >= v_enforce_at;
  v_violations text[] := ARRAY[]::text[];
  v_missing text[] := ARRAY[]::text[];
  v_auto_derived jsonb := '{}'::jsonb;
  v_step_key text;
  v_enqueue_source text;
  v_payload_pkg uuid;
  v_producer_hint text;
  v_critical boolean := false;
BEGIN
  IF NEW.job_type NOT LIKE 'package_%' THEN
    RETURN NEW;
  END IF;

  v_producer_hint := COALESCE(
    NEW.meta->>'enqueue_source', NEW.meta->>'source',
    NEW.payload->>'enqueue_source', 'unknown_producer'
  );

  -- Auto-Heal package_id Column aus payload
  IF NEW.package_id IS NULL AND NEW.payload ? 'package_id' THEN
    BEGIN
      v_payload_pkg := (NEW.payload->>'package_id')::uuid;
      NEW.package_id := v_payload_pkg;
      v_violations := v_violations || 'auto_filled_package_id_column';
      v_auto_derived := v_auto_derived || jsonb_build_object('package_id_column', v_payload_pkg::text);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  -- 1) curriculum_id Pflicht
  IF NEW.payload IS NULL OR NULLIF(NEW.payload->>'curriculum_id','') IS NULL THEN
    v_violations := v_violations || 'missing_curriculum_id';
    v_missing := v_missing || 'curriculum_id';
    v_critical := true;
  END IF;

  -- 2) package_id Pflicht
  IF NEW.package_id IS NULL THEN
    v_violations := v_violations || 'missing_package_id_column';
    v_missing := v_missing || 'package_id_column';
  END IF;
  IF NULLIF(NEW.payload->>'package_id','') IS NULL THEN
    -- Wenn Column gefüllt → in payload mirroren
    IF NEW.package_id IS NOT NULL THEN
      NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('package_id', NEW.package_id::text);
      v_violations := v_violations || 'auto_filled_package_id_payload';
      v_auto_derived := v_auto_derived || jsonb_build_object('package_id_payload', NEW.package_id::text);
    ELSE
      v_violations := v_violations || 'missing_package_id_payload';
      v_missing := v_missing || 'package_id_payload';
      v_critical := true;
    END IF;
  END IF;

  -- 3) step_key Pflicht (auto-derive aus job_type)
  v_step_key := COALESCE(NEW.payload->>'step_key', NEW.payload->>'step', NEW.payload->>'target_step', NEW.meta->>'step_key');
  IF v_step_key IS NULL OR v_step_key = '' THEN
    v_step_key := regexp_replace(NEW.job_type, '^package_', '');
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('step_key', v_step_key);
    v_violations := v_violations || 'auto_derived_step_key';
    v_missing := v_missing || 'step_key';
    v_auto_derived := v_auto_derived || jsonb_build_object('step_key', v_step_key);
  ELSIF NULLIF(NEW.payload->>'step_key','') IS NULL THEN
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('step_key', v_step_key);
    v_violations := v_violations || 'mirrored_step_key_to_payload';
    v_auto_derived := v_auto_derived || jsonb_build_object('step_key_mirrored', v_step_key);
  END IF;

  -- 4) enqueue_source Pflicht
  v_enqueue_source := COALESCE(
    NEW.payload->>'enqueue_source', NEW.meta->>'enqueue_source', NEW.meta->>'source'
  );
  IF v_enqueue_source IS NULL OR v_enqueue_source = '' THEN
    v_enqueue_source := 'unknown_producer';
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    v_violations := v_violations || 'auto_derived_enqueue_source';
    v_missing := v_missing || 'enqueue_source';
    v_auto_derived := v_auto_derived || jsonb_build_object('enqueue_source', 'unknown_producer');
  ELSIF NULLIF(NEW.payload->>'enqueue_source','') IS NULL THEN
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    v_violations := v_violations || 'mirrored_enqueue_source_to_payload';
    v_auto_derived := v_auto_derived || jsonb_build_object('enqueue_source_mirrored', v_enqueue_source);
  END IF;

  -- 5) Slug-Verbot
  IF NEW.payload ? 'slug' OR NEW.payload ? 'profession_slug'
     OR NEW.payload ? 'curriculum_slug' OR NEW.payload ? 'curriculumCode' THEN
    v_violations := v_violations || 'forbidden_slug_field';
    v_critical := true;
  END IF;

  IF array_length(v_violations,1) > 0 THEN
    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id,
      result_status, result_detail, metadata
    ) VALUES (
      CASE WHEN v_enforce AND v_critical THEN 'ssot_payload_blocked' ELSE 'ssot_payload_warn' END,
      'trg_job_queue_ssot_validate', 'job', COALESCE(NEW.package_id::text,'null'),
      CASE WHEN v_enforce AND v_critical THEN 'rejected' ELSE 'warn' END,
      format('Job %s violations: %s', NEW.job_type, array_to_string(v_violations,',')),
      jsonb_build_object(
        'job_type', NEW.job_type,
        'package_id', NEW.package_id,
        'producer', v_producer_hint,
        'violations', v_violations,
        'violations_detail', jsonb_build_object(
          'missing_fields', v_missing,
          'auto_derived', v_auto_derived,
          'producer_hint', v_producer_hint,
          'critical', v_critical,
          'phase', CASE WHEN v_enforce THEN 'enforce' ELSE 'warn' END
        )
      )
    );

    -- Hard-Block bei kritischen Violations
    IF v_enforce AND v_critical THEN
      INSERT INTO public.job_queue_dead_letter(
        job_type, package_id, curriculum_id, payload, meta, violations, source
      ) VALUES (
        NEW.job_type, NEW.package_id,
        NULLIF(NEW.payload->>'curriculum_id','')::uuid,
        NEW.payload, NEW.meta, v_violations, v_producer_hint
      );
      RAISE EXCEPTION 'SSOT VIOLATION (job_queue insert blocked, written to DLQ): % | %',
        NEW.job_type, array_to_string(v_violations,',');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ──────────────────────────────────────────────────────────
-- 3) TRIGGER ANHEFTEN (war in v1 nicht erfolgt!)
-- ──────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_job_queue_ssot_validate ON public.job_queue;
CREATE TRIGGER trg_job_queue_ssot_validate
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_job_queue_ssot_validate();

-- ──────────────────────────────────────────────────────────
-- 4) ON-DEPLOY VERIFICATION RPC (P2)
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_ssot_payload_verification(p_minutes int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'window_minutes', p_minutes,
    'total', COUNT(*),
    'missing_pkg_col',     COUNT(*) FILTER (WHERE package_id IS NULL),
    'missing_pkg_payload', COUNT(*) FILTER (WHERE payload->>'package_id' IS NULL),
    'missing_curriculum',  COUNT(*) FILTER (WHERE payload->>'curriculum_id' IS NULL),
    'missing_step_key',    COUNT(*) FILTER (WHERE payload->>'step_key' IS NULL),
    'missing_source',      COUNT(*) FILTER (WHERE payload->>'enqueue_source' IS NULL),
    'measured_at', now()
  )
  FROM public.job_queue
  WHERE created_at > now() - make_interval(mins => p_minutes)
    AND job_type LIKE 'package_%';
$$;

REVOKE ALL ON FUNCTION public.admin_ssot_payload_verification(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ssot_payload_verification(int) TO service_role;

-- Admin-Wrapper mit has_role-Gate
CREATE OR REPLACE FUNCTION public.admin_get_ssot_verification(p_minutes int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN public.admin_ssot_payload_verification(p_minutes);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_ssot_verification(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ssot_verification(int) TO authenticated;

-- ──────────────────────────────────────────────────────────
-- 5) DASHBOARD-RPCs (P4) — 5 KPIs
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_ssot_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_violations_24h int;
  v_auto_repaired int;
  v_hard_blocked int;
  v_unknown_producers int;
  v_top_producers jsonb;
  v_hard_block_at timestamptz := '2026-05-09 00:00:00+00'::timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT COUNT(*) INTO v_violations_24h
  FROM auto_heal_log
  WHERE action_type IN ('ssot_payload_warn','ssot_payload_blocked')
    AND created_at > now() - interval '24 hours';

  SELECT COUNT(*) INTO v_auto_repaired
  FROM auto_heal_log
  WHERE action_type = 'ssot_payload_warn'
    AND created_at > now() - interval '24 hours'
    AND (metadata->'violations_detail'->'auto_derived') <> '{}'::jsonb;

  SELECT COUNT(*) INTO v_hard_blocked
  FROM job_queue_dead_letter
  WHERE blocked_at > now() - interval '24 hours';

  SELECT COUNT(*) INTO v_unknown_producers
  FROM auto_heal_log
  WHERE action_type IN ('ssot_payload_warn','ssot_payload_blocked')
    AND created_at > now() - interval '24 hours'
    AND metadata->>'producer' = 'unknown_producer';

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_producers
  FROM (
    SELECT
      COALESCE(metadata->>'producer','unknown') AS producer,
      COUNT(*) AS violations
    FROM auto_heal_log
    WHERE action_type IN ('ssot_payload_warn','ssot_payload_blocked')
      AND created_at > now() - interval '24 hours'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'violations_24h', v_violations_24h,
    'auto_repaired_24h', v_auto_repaired,
    'hard_blocked_24h', v_hard_blocked,
    'unknown_producers_24h', v_unknown_producers,
    'top_producers', v_top_producers,
    'hard_block_at', v_hard_block_at,
    'hard_block_in_hours', GREATEST(0, EXTRACT(EPOCH FROM (v_hard_block_at - now()))/3600)::int,
    'measured_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_ssot_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ssot_dashboard() TO authenticated;

-- ──────────────────────────────────────────────────────────
-- 6) REGRESSIONSTEST RPC (P1) — fail-loud bei Lücken
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_ssot_producer_regression_test(p_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_failed boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  WITH samples AS (
    SELECT job_type, package_id, payload, meta,
           COALESCE(meta->>'source', meta->>'enqueue_source', payload->>'enqueue_source') AS producer
    FROM job_queue
    WHERE created_at > now() - make_interval(mins => p_minutes)
      AND job_type LIKE 'package_%'
  )
  SELECT jsonb_build_object(
    'window_minutes', p_minutes,
    'total_samples', COUNT(*),
    'pass_package_id_col',  COUNT(*) FILTER (WHERE package_id IS NOT NULL),
    'pass_package_id_pl',   COUNT(*) FILTER (WHERE payload->>'package_id' IS NOT NULL),
    'pass_curriculum_id',   COUNT(*) FILTER (WHERE payload->>'curriculum_id' IS NOT NULL),
    'pass_step_key',        COUNT(*) FILTER (WHERE payload->>'step_key' IS NOT NULL),
    'pass_enqueue_source',  COUNT(*) FILTER (WHERE payload->>'enqueue_source' IS NOT NULL),
    'fail_package_id_col',  COUNT(*) FILTER (WHERE package_id IS NULL),
    'fail_package_id_pl',   COUNT(*) FILTER (WHERE payload->>'package_id' IS NULL),
    'fail_curriculum_id',   COUNT(*) FILTER (WHERE payload->>'curriculum_id' IS NULL),
    'fail_step_key',        COUNT(*) FILTER (WHERE payload->>'step_key' IS NULL),
    'fail_enqueue_source',  COUNT(*) FILTER (WHERE payload->>'enqueue_source' IS NULL),
    'producers_with_failures', (
      SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb)
      FROM (
        SELECT producer, COUNT(*) AS failures
        FROM samples
        WHERE package_id IS NULL
           OR payload->>'package_id' IS NULL
           OR payload->>'curriculum_id' IS NULL
           OR payload->>'step_key' IS NULL
           OR payload->>'enqueue_source' IS NULL
        GROUP BY producer
        ORDER BY failures DESC
      ) p
    )
  ) INTO v_result FROM samples;

  v_failed := (v_result->>'fail_package_id_col')::int > 0
           OR (v_result->>'fail_package_id_pl')::int > 0
           OR (v_result->>'fail_curriculum_id')::int > 0
           OR (v_result->>'fail_step_key')::int > 0
           OR (v_result->>'fail_enqueue_source')::int > 0;

  v_result := v_result || jsonb_build_object('passed', NOT v_failed);

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                            result_status, result_detail, metadata)
  VALUES ('ssot_producer_regression_test',
          'admin_ssot_producer_regression_test', 'system', 'job_queue',
          CASE WHEN v_failed THEN 'failed' ELSE 'passed' END,
          format('Regression %s — window %s min', CASE WHEN v_failed THEN 'FAILED' ELSE 'PASSED' END, p_minutes),
          v_result);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ssot_producer_regression_test(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ssot_producer_regression_test(int) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────
-- 7) DLQ Detail-RPC für Dashboard
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_dlq_recent(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid, job_type text, package_id uuid, violations text[],
  source text, blocked_at timestamptz, resolution text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id, job_type, package_id, violations, source, blocked_at, resolution
  FROM public.job_queue_dead_letter
  ORDER BY blocked_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.admin_get_dlq_recent(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dlq_recent(int) TO authenticated;
