-- 1. AUDIT-LOG TABELLE
CREATE TABLE IF NOT EXISTS public.artifact_orphan_cleanup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  curriculum_id UUID,
  package_id UUID,
  reason TEXT NOT NULL,
  payload JSONB,
  deleted_by TEXT NOT NULL DEFAULT 'system',
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orphan_cleanup_table ON public.artifact_orphan_cleanup_log(table_name);
CREATE INDEX IF NOT EXISTS idx_orphan_cleanup_at ON public.artifact_orphan_cleanup_log(deleted_at DESC);
ALTER TABLE public.artifact_orphan_cleanup_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin can read orphan cleanup log" ON public.artifact_orphan_cleanup_log;
CREATE POLICY "admin can read orphan cleanup log"
ON public.artifact_orphan_cleanup_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. PROTOKOLLIERE & LÖSCHE die 204 Waisen
WITH to_delete AS (
  SELECT mq.id, mq.curriculum_id, mq.package_id,
         to_jsonb(mq) - 'question_text' - 'options' - 'explanation' AS payload
  FROM public.minicheck_questions mq
  WHERE mq.package_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.curricula c WHERE c.id = mq.curriculum_id)
), logged AS (
  INSERT INTO public.artifact_orphan_cleanup_log
    (table_name, artifact_id, curriculum_id, package_id, reason, payload, deleted_by)
  SELECT 'minicheck_questions', id, curriculum_id, package_id,
         'orphan_curriculum_missing', payload, 'migration_cleanup_2026_04_26'
  FROM to_delete RETURNING artifact_id
)
DELETE FROM public.minicheck_questions WHERE id IN (SELECT artifact_id FROM logged);

-- 3. BACKFILL CHUNK AUDIT TABLE
CREATE TABLE IF NOT EXISTS public.backfill_chunk_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  curriculum_id UUID,
  package_id UUID,
  chunk_size INT,
  rows_updated INT NOT NULL DEFAULT 0,
  duration_ms INT,
  triggers_disabled TEXT[],
  triggers_restored BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backfill_audit_table ON public.backfill_chunk_audit(table_name, created_at DESC);
ALTER TABLE public.backfill_chunk_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin reads backfill audit" ON public.backfill_chunk_audit;
CREATE POLICY "admin reads backfill audit"
ON public.backfill_chunk_audit FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. RPC mit Audit-Reporting
CREATE OR REPLACE FUNCTION public.admin_minicheck_backfill_chunk(
  p_curriculum_id UUID, p_package_id UUID, p_limit INT DEFAULT 2000
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_updated INT := 0;
  v_started TIMESTAMPTZ := clock_timestamp();
  v_duration_ms INT;
  v_disabled TEXT[] := ARRAY[
    'trg_auto_promote_minicheck','trg_guard_minicheck_duplicate',
    'trg_minicheck_quality_guard','trg_minicheck_quality_guard_v2','trg_minicheck_autoenrich'
  ];
  v_t TEXT;
  v_err TEXT;
  v_restored BOOLEAN := false;
BEGIN
  FOREACH v_t IN ARRAY v_disabled LOOP
    BEGIN EXECUTE format('ALTER TABLE public.minicheck_questions DISABLE TRIGGER %I', v_t);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  BEGIN
    WITH batch AS (
      SELECT ctid FROM public.minicheck_questions
      WHERE curriculum_id = p_curriculum_id AND package_id IS NULL LIMIT p_limit
    )
    UPDATE public.minicheck_questions mq SET package_id = p_package_id
      FROM batch WHERE mq.ctid = batch.ctid;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  FOREACH v_t IN ARRAY v_disabled LOOP
    BEGIN EXECUTE format('ALTER TABLE public.minicheck_questions ENABLE TRIGGER %I', v_t);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  v_restored := true;
  v_duration_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_started))::INT * 1000;
  INSERT INTO public.backfill_chunk_audit
    (table_name, curriculum_id, package_id, chunk_size, rows_updated,
     duration_ms, triggers_disabled, triggers_restored, error_message, meta)
  VALUES ('minicheck_questions', p_curriculum_id, p_package_id, p_limit, COALESCE(v_updated,0),
     v_duration_ms, v_disabled, v_restored, v_err, jsonb_build_object('rpc','admin_minicheck_backfill_chunk'));
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
  RETURN COALESCE(v_updated, 0);
END;
$$;

-- 5. ORPHAN-DETECTION VIEW
CREATE OR REPLACE VIEW public.v_artifact_orphans AS
SELECT 'minicheck_questions'::text AS table_name, mq.id AS artifact_id, mq.curriculum_id, mq.package_id,
  CASE
    WHEN mq.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = mq.curriculum_id) THEN 'curriculum_not_found'
    WHEN mq.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = mq.package_id) THEN 'package_not_found'
  END AS reason
FROM public.minicheck_questions mq
WHERE mq.curriculum_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = mq.curriculum_id)
   OR mq.package_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = mq.package_id)
UNION ALL
SELECT 'exam_questions', eq.id, eq.curriculum_id, eq.package_id,
  CASE
    WHEN eq.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eq.curriculum_id) THEN 'curriculum_not_found'
    WHEN eq.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eq.package_id) THEN 'package_not_found'
  END
FROM public.exam_questions eq
WHERE eq.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eq.curriculum_id)
   OR eq.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eq.package_id)
UNION ALL
SELECT 'exam_blueprints', eb.id, eb.curriculum_id, eb.package_id,
  CASE
    WHEN eb.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eb.curriculum_id) THEN 'curriculum_not_found'
    WHEN eb.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eb.package_id) THEN 'package_not_found'
  END
FROM public.exam_blueprints eb
WHERE eb.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eb.curriculum_id)
   OR eb.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eb.package_id)
UNION ALL
SELECT 'oral_exam_blueprints', oeb.id, oeb.curriculum_id, oeb.package_id,
  CASE
    WHEN oeb.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = oeb.curriculum_id) THEN 'curriculum_not_found'
    WHEN oeb.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = oeb.package_id) THEN 'package_not_found'
  END
FROM public.oral_exam_blueprints oeb
WHERE oeb.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = oeb.curriculum_id)
   OR oeb.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = oeb.package_id)
UNION ALL
SELECT 'blueprint_targets', bt.id, bt.curriculum_id, bt.package_id,
  CASE
    WHEN bt.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = bt.curriculum_id) THEN 'curriculum_not_found'
    WHEN bt.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = bt.package_id) THEN 'package_not_found'
  END
FROM public.blueprint_targets bt
WHERE bt.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = bt.curriculum_id)
   OR bt.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = bt.package_id)
UNION ALL
SELECT 'question_blueprints', qb.id, qb.curriculum_id, qb.package_id,
  CASE
    WHEN qb.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = qb.curriculum_id) THEN 'curriculum_not_found'
    WHEN qb.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = qb.package_id) THEN 'package_not_found'
  END
FROM public.question_blueprints qb
WHERE qb.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = qb.curriculum_id)
   OR qb.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = qb.package_id);

CREATE OR REPLACE VIEW public.v_artifact_orphans_summary AS
SELECT 'ARTIFACT_ORPHANS'::text AS cluster_key, table_name, reason,
       COUNT(*) AS orphan_count,
       COUNT(DISTINCT curriculum_id) AS distinct_curricula,
       COUNT(DISTINCT package_id) AS distinct_packages
FROM public.v_artifact_orphans
GROUP BY table_name, reason
ORDER BY orphan_count DESC;

-- 6. CLEANUP-SWEEP RPC
CREATE OR REPLACE FUNCTION public.admin_cleanup_artifact_orphans(
  p_table TEXT DEFAULT NULL, p_max INT DEFAULT 500, p_dry_run BOOLEAN DEFAULT false
) RETURNS TABLE(table_name TEXT, deleted_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tables TEXT[] := ARRAY['minicheck_questions','exam_questions','exam_blueprints',
                           'oral_exam_blueprints','blueprint_targets','question_blueprints'];
  v_t TEXT; v_n INT; v_sql TEXT;
BEGIN
  FOREACH v_t IN ARRAY v_tables LOOP
    IF p_table IS NOT NULL AND p_table <> v_t THEN CONTINUE; END IF;
    IF p_dry_run THEN
      EXECUTE format('SELECT COUNT(*)::int FROM (SELECT 1 FROM public.v_artifact_orphans WHERE table_name = %L LIMIT %s) x',
                     v_t, p_max) INTO v_n;
    ELSE
      v_sql := format($f$
        WITH cand AS (
          SELECT artifact_id, curriculum_id, package_id, reason
          FROM public.v_artifact_orphans WHERE table_name = %L LIMIT %s
        ), logged AS (
          INSERT INTO public.artifact_orphan_cleanup_log
            (table_name, artifact_id, curriculum_id, package_id, reason, deleted_by)
          SELECT %L, artifact_id, curriculum_id, package_id, reason, 'cleanup_sweep'
          FROM cand RETURNING artifact_id
        ), del AS (
          DELETE FROM public.%I WHERE id IN (SELECT artifact_id FROM logged) RETURNING 1
        ) SELECT COUNT(*)::int FROM del
      $f$, v_t, p_max, v_t, v_t);
      EXECUTE v_sql INTO v_n;
    END IF;
    table_name := v_t;
    deleted_count := COALESCE(v_n, 0);
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cleanup_artifact_orphans(TEXT, INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_artifact_orphans(TEXT, INT, BOOLEAN) TO service_role;

-- 7. CLASSIFIER FIX
CREATE OR REPLACE FUNCTION public.fn_classify_unclassified_subcluster(_err text, _meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN _meta ? 'cancel_reason' AND COALESCE(_meta->>'cancel_reason','') <> '' THEN 'GUARDED_CANCEL'
    WHEN _meta ? 'ops_guard_reason' AND COALESCE(_meta->>'ops_guard_reason','') <> '' THEN
      'OPS_GUARD_' || upper(_meta->>'ops_guard_reason')
    WHEN _meta ? 'error_class' OR _meta ? 'error_code' OR _meta ? 'classification_hint'
      OR (_meta ? 'last_error_class' AND COALESCE(_meta->>'last_error_class','') <> '')
      OR (_meta ? 'last_error_kind'  AND COALESCE(_meta->>'last_error_kind','')  <> '')
      OR (_meta ? 'auto_retry_class' AND COALESCE(_meta->>'auto_retry_class','') <> '')
      OR (_meta ? 'recovery_reason'  AND COALESCE(_meta->>'recovery_reason','')  <> '')
      OR (_meta ? 'last_error_reason' AND COALESCE(_meta->>'last_error_reason','') <> '')
    THEN 'UNCLASSIFIED_RECLASSIFIABLE'
    WHEN _err IS NULL OR _err = '' THEN 'UNCLASSIFIED_EMPTY'
    WHEN _err ~* 'timeout|timed[_ ]out|deadline|temporarily|temp.*unavailable|503|502|504|retry|transient|lease|stale' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'rate[_ ]?limit|429|too many requests|throttle' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'connection|ECONN|ETIMEDOUT|network|socket' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'constraint|null value|invalid input|payload|schema|access denied|forbidden|causality|no curriculum|no blueprints|no effect|guard_violation' THEN 'UNCLASSIFIED_STRUCTURAL'
    ELSE 'UNCLASSIFIED_UNKNOWN'
  END
$$;