DROP VIEW IF EXISTS public.v_artifact_orphans_summary;
DROP VIEW IF EXISTS public.v_artifact_orphans;

CREATE VIEW public.v_artifact_orphans AS
WITH base AS (
SELECT 'minicheck_questions'::text AS table_name, mq.id AS artifact_id, mq.curriculum_id, mq.package_id,
  CASE WHEN mq.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = mq.curriculum_id) THEN 'curriculum_not_found'
    WHEN mq.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = mq.package_id) THEN 'package_not_found' END AS reason
FROM public.minicheck_questions mq
WHERE mq.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = mq.curriculum_id)
   OR mq.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = mq.package_id)
UNION ALL
SELECT 'exam_questions', eq.id, eq.curriculum_id, eq.package_id,
  CASE WHEN eq.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eq.curriculum_id) THEN 'curriculum_not_found'
    WHEN eq.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eq.package_id) THEN 'package_not_found' END
FROM public.exam_questions eq
WHERE eq.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eq.curriculum_id)
   OR eq.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eq.package_id)
UNION ALL
SELECT 'exam_blueprints', eb.id, eb.curriculum_id, eb.package_id,
  CASE WHEN eb.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eb.curriculum_id) THEN 'curriculum_not_found'
    WHEN eb.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eb.package_id) THEN 'package_not_found' END
FROM public.exam_blueprints eb
WHERE eb.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = eb.curriculum_id)
   OR eb.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = eb.package_id)
UNION ALL
SELECT 'oral_exam_blueprints', oeb.id, oeb.curriculum_id, oeb.package_id,
  CASE WHEN oeb.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = oeb.curriculum_id) THEN 'curriculum_not_found'
    WHEN oeb.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = oeb.package_id) THEN 'package_not_found' END
FROM public.oral_exam_blueprints oeb
WHERE oeb.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = oeb.curriculum_id)
   OR oeb.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = oeb.package_id)
UNION ALL
SELECT 'blueprint_targets', bt.id, bt.curriculum_id, bt.package_id,
  CASE WHEN bt.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = bt.curriculum_id) THEN 'curriculum_not_found'
    WHEN bt.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = bt.package_id) THEN 'package_not_found' END
FROM public.blueprint_targets bt
WHERE bt.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = bt.curriculum_id)
   OR bt.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = bt.package_id)
UNION ALL
SELECT 'question_blueprints', qb.id, qb.curriculum_id, qb.package_id,
  CASE WHEN qb.curriculum_id IS NULL THEN 'missing_curriculum_id'
    WHEN NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = qb.curriculum_id) THEN 'curriculum_not_found'
    WHEN qb.package_id IS NULL THEN 'missing_package_id'
    WHEN NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = qb.package_id) THEN 'package_not_found' END
FROM public.question_blueprints qb
WHERE qb.curriculum_id IS NULL OR NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id = qb.curriculum_id)
   OR qb.package_id IS NULL OR NOT EXISTS (SELECT 1 FROM course_packages p WHERE p.id = qb.package_id)
)
SELECT b.table_name, b.artifact_id, b.curriculum_id, b.package_id, b.reason,
  CASE WHEN b.reason IN ('curriculum_not_found','package_not_found','missing_curriculum_id') THEN 'hard_orphan'
       WHEN b.reason = 'missing_package_id' AND b.curriculum_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM curricula c WHERE c.id = b.curriculum_id) THEN 'backfillable'
       ELSE 'inspect' END AS severity
FROM base b;

CREATE VIEW public.v_artifact_orphans_summary AS
SELECT 'ARTIFACT_ORPHANS'::text AS cluster_key, table_name, reason, severity,
       COUNT(*) AS orphan_count,
       COUNT(DISTINCT curriculum_id) AS distinct_curricula,
       COUNT(DISTINCT package_id) AS distinct_packages
FROM public.v_artifact_orphans
GROUP BY table_name, reason, severity
ORDER BY orphan_count DESC;

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
      EXECUTE format('SELECT COUNT(*)::int FROM (SELECT 1 FROM public.v_artifact_orphans WHERE table_name = %L AND severity = %L LIMIT %s) x',
                     v_t, 'hard_orphan', p_max) INTO v_n;
    ELSE
      v_sql := format($f$
        WITH cand AS (
          SELECT artifact_id, curriculum_id, package_id, reason
          FROM public.v_artifact_orphans
          WHERE table_name = %L AND severity = 'hard_orphan' LIMIT %s
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