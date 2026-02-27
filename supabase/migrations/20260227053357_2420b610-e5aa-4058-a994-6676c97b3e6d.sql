
-- 1) Admin Matrix Pins: SSOT for which curriculum = MFA/PKA
CREATE TABLE IF NOT EXISTS public.admin_matrix_pins (
  key text PRIMARY KEY,
  curriculum_id uuid NOT NULL
);
ALTER TABLE public.admin_matrix_pins ENABLE ROW LEVEL SECURITY;
-- Only service_role can read/write
CREATE POLICY "Service role only" ON public.admin_matrix_pins
  FOR ALL USING (false);

-- Seed known pins
INSERT INTO public.admin_matrix_pins (key, curriculum_id) VALUES
  ('MFA', '105dd602-ea07-478f-8593-fd149ec5b676'),
  ('PKA', '604d730d-e008-468a-b4ef-a9477de06ef4')
ON CONFLICT (key) DO UPDATE SET curriculum_id = EXCLUDED.curriculum_id;

-- 2) Per-curriculum detail view
CREATE OR REPLACE VIEW public.admin_elite_matrix_curriculum_v AS
WITH elite AS (
  SELECT
    s.curriculum_id,
    s.q_total,
    s.q_approved,
    s.q_annotated,
    s.pct_annotated,
    s.elite_cnt,
    s.advanced_cnt,
    s.avg_score,
    s.multi_variable_cnt,
    s.transfer_cnt,
    s.pct_elite,
    s.competencies_with_questions
  FROM public.curriculum_elite_summary_v s
),
fresh AS (
  SELECT
    curriculum_id,
    count(*) FILTER (WHERE freshness = 'fresh')::int AS fresh_cnt,
    count(*) FILTER (WHERE freshness = 'stale')::int AS stale_cnt,
    count(*) FILTER (WHERE freshness = 'missing')::int AS missing_cnt
  FROM public.stale_elite_annotations_v
  GROUP BY curriculum_id
),
less AS (
  SELECT co.curriculum_id, count(l.id)::int AS lessons_cnt
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses co ON co.id = m.course_id
  GROUP BY co.curriculum_id
),
oral AS (
  SELECT
    curriculum_id,
    count(*)::int AS oral_blueprints_cnt,
    count(*) FILTER (
      WHERE rubric IS NOT NULL
        AND jsonb_typeof(rubric) = 'object'
        AND (SELECT count(*) FROM jsonb_object_keys(rubric)) >= 3
    )::int AS oral_hardened_cnt
  FROM public.oral_exam_blueprints
  GROUP BY curriculum_id
)
SELECT
  e.curriculum_id,
  c.title AS curriculum_title,
  e.q_total,
  e.q_approved,
  e.q_annotated,
  e.pct_annotated,
  e.elite_cnt,
  e.advanced_cnt,
  e.avg_score,
  e.multi_variable_cnt,
  e.transfer_cnt,
  e.pct_elite,
  CASE WHEN e.q_total > 0 THEN round(100.0 * e.multi_variable_cnt / e.q_total, 1) ELSE 0 END AS pct_multivariable,
  CASE WHEN e.q_total > 0 THEN round(100.0 * e.transfer_cnt / e.q_total, 1) ELSE 0 END AS pct_transfer,
  coalesce(f.fresh_cnt, 0) AS fresh_cnt,
  coalesce(f.stale_cnt, 0) AS stale_cnt,
  coalesce(f.missing_cnt, 0) AS missing_cnt,
  (e.q_approved > 0) AS has_exam_pool,
  (e.q_total > 0 AND e.q_approved = e.q_total) AS approved_coverage_100,
  (e.q_approved > 0 AND e.q_annotated >= e.q_approved) AS elite_annotation_complete,
  (e.q_annotated > 0) AS minicheck_ready,
  coalesce(l.lessons_cnt, 0) AS lessons_cnt,
  coalesce(o.oral_blueprints_cnt, 0) AS oral_blueprints_cnt,
  coalesce(o.oral_hardened_cnt, 0) AS oral_hardened_cnt,
  CASE WHEN coalesce(o.oral_blueprints_cnt, 0) > 0
    THEN round(100.0 * coalesce(o.oral_hardened_cnt, 0) / o.oral_blueprints_cnt, 1)
    ELSE 0 END AS pct_oral_hardened
FROM elite e
JOIN public.curricula c ON c.id = e.curriculum_id
LEFT JOIN fresh f ON f.curriculum_id = e.curriculum_id
LEFT JOIN less l ON l.curriculum_id = e.curriculum_id
LEFT JOIN oral o ON o.curriculum_id = e.curriculum_id;

-- 3) Matrix view (MFA / PKA / Andere aggregiert)
CREATE OR REPLACE VIEW public.admin_elite_matrix_v AS
WITH pins AS (
  SELECT * FROM public.admin_matrix_pins
),
pinned AS (
  SELECT p.key AS col, a.*
  FROM public.admin_elite_matrix_curriculum_v a
  JOIN pins p ON p.curriculum_id = a.curriculum_id
),
others AS (
  SELECT
    'Andere'::text AS col,
    NULL::uuid AS curriculum_id,
    'Andere Kurse (aggregiert)'::text AS curriculum_title,
    sum(q_total)::int AS q_total,
    sum(q_approved)::int AS q_approved,
    sum(q_annotated)::int AS q_annotated,
    CASE WHEN sum(q_total) > 0 THEN round(100.0 * sum(q_annotated) / sum(q_total), 1) ELSE 0 END AS pct_annotated,
    sum(elite_cnt)::int AS elite_cnt,
    sum(advanced_cnt)::int AS advanced_cnt,
    round(avg(avg_score)::numeric, 2) AS avg_score,
    sum(multi_variable_cnt)::int AS multi_variable_cnt,
    sum(transfer_cnt)::int AS transfer_cnt,
    CASE WHEN sum(q_total) > 0 THEN round(100.0 * sum(elite_cnt) / sum(q_total), 1) ELSE 0 END AS pct_elite,
    CASE WHEN sum(q_total) > 0 THEN round(100.0 * sum(multi_variable_cnt) / sum(q_total), 1) ELSE 0 END AS pct_multivariable,
    CASE WHEN sum(q_total) > 0 THEN round(100.0 * sum(transfer_cnt) / sum(q_total), 1) ELSE 0 END AS pct_transfer,
    sum(fresh_cnt)::int AS fresh_cnt,
    sum(stale_cnt)::int AS stale_cnt,
    sum(missing_cnt)::int AS missing_cnt,
    (sum(q_approved) > 0) AS has_exam_pool,
    (sum(q_total) > 0 AND sum(q_approved) = sum(q_total)) AS approved_coverage_100,
    (sum(q_approved) > 0 AND sum(q_annotated) >= sum(q_approved)) AS elite_annotation_complete,
    (sum(q_annotated) > 0) AS minicheck_ready,
    sum(lessons_cnt)::int AS lessons_cnt,
    sum(oral_blueprints_cnt)::int AS oral_blueprints_cnt,
    sum(oral_hardened_cnt)::int AS oral_hardened_cnt,
    CASE WHEN sum(oral_blueprints_cnt) > 0
      THEN round(100.0 * sum(oral_hardened_cnt) / sum(oral_blueprints_cnt), 1)
      ELSE 0 END AS pct_oral_hardened
  FROM public.admin_elite_matrix_curriculum_v
  WHERE curriculum_id NOT IN (SELECT curriculum_id FROM pins)
)
SELECT * FROM pinned
UNION ALL
SELECT * FROM others;
