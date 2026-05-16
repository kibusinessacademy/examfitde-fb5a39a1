
CREATE OR REPLACE VIEW public.v_seo_wave_candidates AS
WITH pkg AS (
  SELECT DISTINCT ON (cp.curriculum_id)
         cp.curriculum_id, cp.id AS package_id, cp.status::text AS pkg_status, cp.title AS pkg_title
    FROM public.course_packages cp
   WHERE cp.status::text = 'published'
   ORDER BY cp.curriculum_id, cp.created_at DESC
),
norm AS (
  SELECT q.id AS qid,
         CASE WHEN q.intent_key LIKE 'intent\_%' ESCAPE '\' THEN substring(q.intent_key from 8) ELSE q.intent_key END AS intent_norm
    FROM public.seo_content_priority_queue q
),
active_jobs AS (
  SELECT jq.package_id,
         jq.payload->>'competency_id' AS competency_id_txt,
         jq.payload->>'intent_template' AS intent_template,
         COALESCE(jq.payload->>'persona_type','azubi') AS persona_type,
         count(*) AS active_count
    FROM public.job_queue jq
   WHERE jq.job_type = 'seo_intent_page_generate'
     AND jq.status IN ('pending','processing')
   GROUP BY 1,2,3,4
),
existing_pages AS (
  SELECT scp.curriculum_id, scp.competency_id, scp.intent_template,
         COALESCE(scp.persona_type,'azubi') AS persona_type,
         max(scp.last_generated_at) AS last_generated_at,
         bool_or(scp.status = 'published') AS has_published
    FROM public.seo_content_pages scp
   WHERE scp.page_type IS DISTINCT FROM 'pillar_page'
   GROUP BY 1,2,3,4
),
recent_failures AS (
  SELECT (ahl.metadata->>'package_id')::uuid AS package_id,
         ahl.metadata->>'intent_key' AS intent_key,
         count(*) AS fail_count_24h
    FROM public.auto_heal_log ahl
   WHERE ahl.action_type = 'seo_wave_enqueue_attempt'
     AND ahl.result_status IN ('error','skipped')
     AND ahl.created_at >= now() - interval '24 hours'
     AND ahl.metadata->>'reason' IN ('PKG_NOT_PUBLISHED','SEO_DEAD_END')
   GROUP BY 1,2
),
spoke_counts AS (
  SELECT curriculum_id, count(*) AS published_spoke_count
    FROM public.seo_content_pages
   WHERE status='published' AND page_type IS DISTINCT FROM 'pillar_page'
   GROUP BY 1
)
SELECT
  q.id                       AS priority_queue_id,
  q.curriculum_id,
  pkg.package_id,
  cur.title                  AS curriculum_title,
  pkg.pkg_title              AS package_title,
  q.competency_id,
  q.intent_key,
  ('intent_' || n.intent_norm) AS intent_template,
  COALESCE(q.persona_type,'azubi') AS persona_type,
  q.package_publish_eligible AS publish_eligible,
  q.thin_content_risk,
  COALESCE(q.cluster_priority, 3) AS cluster_priority,
  COALESCE(q.semrush_volume, 0)   AS semrush_volume,
  CASE n.intent_norm
    WHEN 'pruefungsfragen' THEN 9
    WHEN 'lernplan'        THEN 8
    WHEN 'typische_fehler' THEN 6
    WHEN 'durchfallquote'  THEN 5
    ELSE 4
  END AS intent_priority,
  COALESCE(sc.published_spoke_count, 0) AS existing_spoke_count,
  ROUND(LEAST(COALESCE(sc.published_spoke_count,0)::numeric / 8.0, 1.0), 3) AS pillar_progress_ratio,
  (aj.active_count IS NOT NULL AND aj.active_count > 0) AS active_job_exists,
  COALESCE(rf.fail_count_24h, 0) AS recent_failure_count_24h,
  ep.last_generated_at,
  ep.has_published AS has_existing_published_page,
  LEAST(100,
        COALESCE(q.cluster_priority,3) * 8
      + (CASE n.intent_norm WHEN 'pruefungsfragen' THEN 25 WHEN 'lernplan' THEN 20
                            WHEN 'typische_fehler' THEN 12 WHEN 'durchfallquote' THEN 10 ELSE 5 END)
      + LEAST(COALESCE(q.semrush_volume,0)/100, 30)
      + CASE q.thin_content_risk WHEN 'low' THEN 15 WHEN 'medium' THEN 5 ELSE 0 END
  )::int AS seo_score_projection,
  CASE
    WHEN pkg.package_id IS NULL THEN 'no_published_package'
    WHEN NOT q.package_publish_eligible THEN 'pkg_not_published'
    WHEN q.thin_content_risk IN ('high','blocked') THEN 'thin_content_risk_'||q.thin_content_risk
    WHEN COALESCE(ep.has_published,false) THEN 'already_published'
    WHEN aj.active_count IS NOT NULL AND aj.active_count > 0 THEN 'active_job_exists'
    WHEN COALESCE(rf.fail_count_24h,0) >= 2 THEN 'cooldown_recent_failures'
    ELSE NULL
  END AS exclusion_reason,
  (
    pkg.package_id IS NOT NULL
    AND q.package_publish_eligible
    AND q.thin_content_risk NOT IN ('high','blocked')
    AND NOT COALESCE(ep.has_published,false)
    AND (aj.active_count IS NULL OR aj.active_count = 0)
    AND COALESCE(rf.fail_count_24h,0) < 2
  ) AS wave_eligible
FROM public.seo_content_priority_queue q
JOIN public.curricula cur ON cur.id = q.curriculum_id
JOIN norm n               ON n.qid = q.id
LEFT JOIN pkg                  ON pkg.curriculum_id = q.curriculum_id
LEFT JOIN active_jobs aj       ON aj.package_id = pkg.package_id
                              AND aj.competency_id_txt = q.competency_id::text
                              AND aj.intent_template = ('intent_' || n.intent_norm)
                              AND aj.persona_type = COALESCE(q.persona_type,'azubi')
LEFT JOIN existing_pages ep    ON ep.curriculum_id = q.curriculum_id
                              AND ep.competency_id = q.competency_id
                              AND ep.intent_template = ('intent_' || n.intent_norm)
                              AND ep.persona_type = COALESCE(q.persona_type,'azubi')
LEFT JOIN recent_failures rf   ON rf.package_id = pkg.package_id AND rf.intent_key = q.intent_key
LEFT JOIN spoke_counts sc      ON sc.curriculum_id = q.curriculum_id;

REVOKE ALL ON public.v_seo_wave_candidates FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_seo_wave_candidates TO service_role;
