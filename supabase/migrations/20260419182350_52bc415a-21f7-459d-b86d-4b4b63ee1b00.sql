INSERT INTO public.ops_job_type_registry (job_type, pool, description)
VALUES (
  'package_repair_exam_pool_competency_coverage',
  'pipeline',
  'Targeted competency-coverage repair: enqueues fan-out package_generate_exam_pool jobs for under-covered competencies (per-competency target). Complements lf_coverage repair; addresses Auto-Repair-Limit loops where LF coverage passes but individual competencies are empty.'
)
ON CONFLICT (job_type) DO UPDATE
  SET pool = EXCLUDED.pool,
      description = EXCLUDED.description;