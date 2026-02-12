
DROP VIEW IF EXISTS public.ops_blocked_packages CASCADE;
DROP VIEW IF EXISTS public.ops_seeding_summary CASCADE;

CREATE VIEW public.ops_seeding_summary AS
SELECT
  cp.id AS package_id, cp.certification_id, cp.title AS package_title, cp.status AS package_status,
  c.title AS curriculum_title, c.status AS curriculum_status, c.seeding_version, c.seeding_completed_at,
  COALESCE(lf.cnt, 0) AS learning_field_count, COALESCE(comp.cnt, 0) AS competency_count, COALESCE(les.cnt, 0) AS lesson_count,
  CASE WHEN COALESCE(lf.cnt,0)>0 THEN ROUND(COALESCE(comp.cnt,0)::numeric/lf.cnt,1) ELSE 0 END AS avg_competencies_per_lf,
  COALESCE(empty_lf.cnt,0) AS empty_lf_count, COALESCE(orphan_comp.cnt,0) AS orphan_competency_count,
  CASE WHEN c.id IS NULL THEN 'missing' WHEN COALESCE(lf.cnt,0)=0 OR COALESCE(comp.cnt,0)=0 THEN 'missing'
       WHEN COALESCE(lf.cnt,0)<5 OR COALESCE(comp.cnt,0)<10 THEN 'partial' ELSE 'ready' END AS seed_status,
  CASE WHEN c.seeding_version IS NULL THEN 'unversioned' ELSE c.seeding_version END AS version_status,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN c.id IS NULL THEN 'curriculum_not_found' END,
    CASE WHEN c.status!='frozen' AND c.id IS NOT NULL THEN 'curriculum_not_frozen' END,
    CASE WHEN COALESCE(lf.cnt,0)=0 THEN 'no_learning_fields' END,
    CASE WHEN COALESCE(lf.cnt,0) BETWEEN 1 AND 4 THEN 'few_learning_fields' END,
    CASE WHEN COALESCE(comp.cnt,0)=0 THEN 'no_competencies' END,
    CASE WHEN COALESCE(comp.cnt,0) BETWEEN 1 AND 9 THEN 'few_competencies' END,
    CASE WHEN COALESCE(lf.cnt,0)>0 AND COALESCE(comp.cnt,0)::numeric/GREATEST(lf.cnt,1)<2 THEN 'low_competency_density' END,
    CASE WHEN COALESCE(empty_lf.cnt,0)>0 THEN 'empty_learning_fields' END,
    CASE WHEN COALESCE(orphan_comp.cnt,0)>0 THEN 'orphan_competencies' END
  ], NULL) AS seed_reasons
FROM public.course_packages cp
LEFT JOIN public.curricula c ON c.id=cp.certification_id
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.learning_fields x WHERE x.curriculum_id=c.id) lf ON TRUE
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.competencies x JOIN public.learning_fields y ON y.id=x.learning_field_id WHERE y.curriculum_id=c.id) comp ON TRUE
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.lessons x JOIN public.modules y ON y.id=x.module_id JOIN public.courses z ON z.id=y.course_id WHERE z.curriculum_id=c.id) les ON TRUE
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.learning_fields x WHERE x.curriculum_id=c.id AND NOT EXISTS (SELECT 1 FROM public.competencies y WHERE y.learning_field_id=x.id)) empty_lf ON TRUE
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.competencies x JOIN public.learning_fields y ON y.id=x.learning_field_id WHERE y.curriculum_id=c.id AND NOT EXISTS (SELECT 1 FROM public.lessons z WHERE z.competency_id=x.id)) orphan_comp ON TRUE;

CREATE VIEW public.ops_blocked_packages AS
SELECT cp.id AS package_id, cp.title, cp.status, cp.build_progress, cp.integrity_passed, cp.integrity_report, cp.council_approved, cp.created_at,
  ar.status AS autofix_status, ar.current_round AS autofix_round, ar.last_score AS autofix_last_score,
  ss.seed_status, ss.seed_reasons, ss.seeding_version, ss.version_status, ss.avg_competencies_per_lf, ss.empty_lf_count, ss.orphan_competency_count,
  CASE WHEN ss.seed_status IN ('missing','partial') THEN 'seed_incomplete' WHEN cp.status='failed' AND ar.status='frozen' THEN 'regression_freeze'
       WHEN cp.status='failed' AND ar.status='budget_exceeded' THEN 'budget_exceeded' WHEN cp.status='failed' THEN 'build_failed'
       WHEN cp.integrity_passed=false THEN 'integrity_failed' ELSE 'unknown' END AS block_reason,
  CASE WHEN ss.seed_status IN ('missing','partial') THEN 1 WHEN cp.status='failed' THEN 2 WHEN cp.integrity_passed=false THEN 3 ELSE 4 END AS block_priority
FROM public.course_packages cp
LEFT JOIN public.ops_seeding_summary ss ON ss.package_id=cp.id
LEFT JOIN LATERAL (SELECT status, current_round, last_score FROM public.autofix_runs afr WHERE afr.package_id=cp.id ORDER BY afr.created_at DESC LIMIT 1) ar ON TRUE
WHERE cp.status IN ('failed','building','council_review','qa','planning') AND (cp.status='failed' OR cp.integrity_passed=false OR ss.seed_status IN ('missing','partial'))
ORDER BY block_priority, cp.created_at;
