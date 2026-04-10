
-- KPI 1: Lesson Completion Impact
CREATE OR REPLACE VIEW public.v_humor_lesson_impact AS
WITH humor_exposure AS (
  SELECT DISTINCT
    hde.user_id,
    hde.lesson_id,
    min(hde.created_at) AS first_seen_at
  FROM humor_delivery_events hde
  WHERE hde.surface = 'lesson_intro'
    AND hde.lesson_id IS NOT NULL
  GROUP BY hde.user_id, hde.lesson_id
),
lesson_completion AS (
  SELECT
    lp.user_id,
    lp.lesson_id,
    max(lp.completed_at) AS completed_at
  FROM learning_progress lp
  WHERE lp.completed = true
  GROUP BY lp.user_id, lp.lesson_id
),
joined AS (
  SELECT
    coalesce(h.user_id, l.user_id) AS user_id,
    coalesce(h.lesson_id, l.lesson_id) AS lesson_id,
    CASE WHEN h.user_id IS NOT NULL THEN 1 ELSE 0 END AS saw_humor,
    CASE WHEN l.completed_at IS NOT NULL THEN 1 ELSE 0 END AS completed
  FROM humor_exposure h
  FULL OUTER JOIN lesson_completion l
    ON h.user_id = l.user_id AND h.lesson_id = l.lesson_id
)
SELECT
  saw_humor,
  count(*) AS total_pairs,
  sum(completed) AS completed_count,
  round(100.0 * sum(completed) / nullif(count(*), 0), 1) AS completion_rate_pct
FROM joined
GROUP BY saw_humor;

-- KPI 2: MiniCheck Start Impact
CREATE OR REPLACE VIEW public.v_humor_minicheck_impact AS
WITH humor_outro AS (
  SELECT
    user_id,
    lesson_id,
    min(created_at) AS seen_at
  FROM humor_delivery_events
  WHERE surface = 'lesson_outro'
    AND lesson_id IS NOT NULL
  GROUP BY user_id, lesson_id
),
minicheck_start AS (
  SELECT DISTINCT
    user_id,
    lesson_id
  FROM minicheck_attempts
  WHERE lesson_id IS NOT NULL
),
joined AS (
  SELECT
    coalesce(h.user_id, m.user_id) AS user_id,
    coalesce(h.lesson_id, m.lesson_id) AS lesson_id,
    CASE WHEN h.user_id IS NOT NULL THEN 1 ELSE 0 END AS saw_humor,
    CASE WHEN m.user_id IS NOT NULL THEN 1 ELSE 0 END AS started
  FROM humor_outro h
  FULL OUTER JOIN minicheck_start m
    ON h.user_id = m.user_id AND h.lesson_id = m.lesson_id
)
SELECT
  saw_humor,
  count(*) AS total_pairs,
  sum(started) AS started_count,
  round(100.0 * sum(started) / nullif(count(*), 0), 1) AS start_rate_pct
FROM joined
GROUP BY saw_humor;

-- KPI 3: Tutor Impact (session-level)
CREATE OR REPLACE VIEW public.v_humor_tutor_impact AS
WITH tutor_with_humor AS (
  SELECT DISTINCT ats.id AS session_id
  FROM ai_tutor_sessions ats
  JOIN humor_delivery_events hde
    ON hde.session_id = ats.id
   AND hde.surface = 'tutor'
),
session_stats AS (
  SELECT
    ats.id AS session_id,
    ats.user_id,
    CASE WHEN twh.session_id IS NOT NULL THEN 1 ELSE 0 END AS has_humor,
    (SELECT count(*) FROM ai_tutor_messages atm WHERE atm.session_id = ats.id) AS msg_count,
    ats.status
  FROM ai_tutor_sessions ats
  LEFT JOIN tutor_with_humor twh ON twh.session_id = ats.id
  WHERE ats.status IN ('completed', 'active')
)
SELECT
  has_humor,
  count(*) AS total_sessions,
  round(avg(msg_count), 1) AS avg_messages,
  count(*) FILTER (WHERE msg_count >= 4) AS engaged_sessions,
  round(100.0 * count(*) FILTER (WHERE msg_count >= 4) / nullif(count(*), 0), 1) AS engagement_rate_pct
FROM session_stats
GROUP BY has_humor;

-- KPI 4: Recovery Impact
CREATE OR REPLACE VIEW public.v_humor_recovery_impact AS
WITH failed_attempts AS (
  SELECT DISTINCT
    ma.user_id,
    ma.lesson_id
  FROM minicheck_attempts ma
  WHERE ma.is_correct = false
    AND ma.lesson_id IS NOT NULL
),
humor_after AS (
  SELECT DISTINCT
    hde.user_id,
    hde.lesson_id
  FROM humor_delivery_events hde
  WHERE hde.surface = 'minicheck_result'
),
retry AS (
  SELECT
    ma2.user_id,
    ma2.lesson_id
  FROM minicheck_attempts ma2
  WHERE ma2.lesson_id IS NOT NULL
  GROUP BY ma2.user_id, ma2.lesson_id
  HAVING count(DISTINCT ma2.session_id) > 1
),
joined AS (
  SELECT
    f.user_id,
    f.lesson_id,
    CASE WHEN h.user_id IS NOT NULL THEN 1 ELSE 0 END AS saw_humor,
    CASE WHEN r.user_id IS NOT NULL THEN 1 ELSE 0 END AS retried
  FROM failed_attempts f
  LEFT JOIN humor_after h ON h.user_id = f.user_id AND h.lesson_id = f.lesson_id
  LEFT JOIN retry r ON r.user_id = f.user_id AND r.lesson_id = f.lesson_id
)
SELECT
  saw_humor,
  count(*) AS total_users,
  sum(retried) AS retried_count,
  round(100.0 * sum(retried) / nullif(count(*), 0), 1) AS retry_rate_pct
FROM joined
GROUP BY saw_humor;
