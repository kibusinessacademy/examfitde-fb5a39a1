
-- VIEW 1: QC Backlog per Curriculum
CREATE OR REPLACE VIEW v_ops_qc_backlog AS
SELECT
  c.id AS curriculum_id,
  c.title AS curriculum_title,
  COUNT(*) FILTER (
    WHERE eq.status = 'draft' 
    AND eq.question_text IS NOT NULL AND eq.options IS NOT NULL
    AND eq.correct_answer IS NOT NULL AND eq.competency_id IS NOT NULL
    AND eq.difficulty IS NOT NULL AND eq.cognitive_level IS NOT NULL
    AND length(eq.question_text) >= 10
  ) AS promotable_drafts,
  COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.qc_status = 'pending') AS review_pending,
  COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.qc_status = 'tier1_passed') AS review_tier1_passed,
  COUNT(*) FILTER (WHERE eq.status = 'approved') AS total_approved,
  COUNT(*) FILTER (WHERE eq.status = 'rejected') AS total_rejected,
  COUNT(*) AS total_questions,
  CASE WHEN COUNT(*) FILTER (WHERE eq.status IN ('approved', 'rejected')) > 0
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE eq.status = 'approved') / COUNT(*) FILTER (WHERE eq.status IN ('approved', 'rejected')), 1)
    ELSE 0
  END AS approval_rate_pct,
  EXTRACT(EPOCH FROM (now() - MIN(eq.created_at) FILTER (
    WHERE eq.status = 'review' AND eq.qc_status = 'pending'
  ))) / 3600 AS oldest_review_pending_hours,
  CASE
    WHEN COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.qc_status = 'pending') > 10000 THEN 'CRITICAL'
    WHEN COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.qc_status = 'pending') > 1000 THEN 'WARNING'
    WHEN COUNT(*) FILTER (
      WHERE eq.status = 'draft' AND eq.question_text IS NOT NULL AND eq.options IS NOT NULL
      AND eq.correct_answer IS NOT NULL AND length(eq.question_text) >= 10
    ) > 5000 THEN 'STALE_DRAFTS'
    ELSE 'HEALTHY'
  END AS backlog_health
FROM curricula c
LEFT JOIN exam_questions eq ON eq.curriculum_id = c.id
GROUP BY c.id, c.title
HAVING COUNT(*) > 0
ORDER BY COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.qc_status = 'pending') DESC;

-- VIEW 2: QC Promotion Funnel (based on created_at windows)
CREATE OR REPLACE VIEW v_ops_qc_promotion_funnel AS
SELECT 
  c.id AS curriculum_id,
  c.title AS curriculum_title,
  COUNT(*) FILTER (WHERE eq.status = 'approved' AND eq.created_at > now() - interval '24 hours') AS approved_24h,
  COUNT(*) FILTER (WHERE eq.status = 'rejected' AND eq.created_at > now() - interval '24 hours') AS rejected_24h,
  COUNT(*) FILTER (WHERE eq.qc_status = 'tier1_passed' AND eq.created_at > now() - interval '24 hours') AS tier1_passed_24h,
  COUNT(*) FILTER (WHERE eq.status = 'approved' AND eq.created_at > now() - interval '7 days') AS approved_7d,
  COUNT(*) FILTER (WHERE eq.status = 'rejected' AND eq.created_at > now() - interval '7 days') AS rejected_7d,
  COUNT(*) FILTER (WHERE eq.status = 'approved' AND eq.created_at > now() - interval '30 days') AS approved_30d,
  COUNT(*) FILTER (WHERE eq.status = 'rejected' AND eq.created_at > now() - interval '30 days') AS rejected_30d,
  CASE WHEN COUNT(*) FILTER (WHERE eq.status IN ('approved','rejected') AND eq.created_at > now() - interval '7 days') > 0
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE eq.status = 'approved' AND eq.created_at > now() - interval '7 days')
      / COUNT(*) FILTER (WHERE eq.status IN ('approved','rejected') AND eq.created_at > now() - interval '7 days'), 1)
    ELSE NULL
  END AS approval_rate_7d
FROM curricula c
JOIN exam_questions eq ON eq.curriculum_id = c.id
GROUP BY c.id, c.title
HAVING COUNT(*) > 100
ORDER BY approved_7d DESC;

-- VIEW 3: QC Backlog Age Distribution
CREATE OR REPLACE VIEW v_ops_qc_backlog_age AS
SELECT
  c.id AS curriculum_id,
  c.title AS curriculum_title,
  COUNT(*) FILTER (WHERE eq.status = 'review') AS total_in_review,
  COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.created_at > now() - interval '1 hour') AS review_lt_1h,
  COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.created_at BETWEEN now() - interval '24 hours' AND now() - interval '1 hour') AS review_1h_24h,
  COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.created_at BETWEEN now() - interval '7 days' AND now() - interval '24 hours') AS review_1d_7d,
  COUNT(*) FILTER (WHERE eq.status = 'review' AND eq.created_at < now() - interval '7 days') AS review_gt_7d,
  EXTRACT(EPOCH FROM (now() - MIN(eq.created_at) FILTER (WHERE eq.status = 'review'))) / 3600 AS oldest_review_hours
FROM curricula c
JOIN exam_questions eq ON eq.curriculum_id = c.id
GROUP BY c.id, c.title
HAVING COUNT(*) FILTER (WHERE eq.status = 'review') > 0
ORDER BY oldest_review_hours DESC NULLS LAST;
