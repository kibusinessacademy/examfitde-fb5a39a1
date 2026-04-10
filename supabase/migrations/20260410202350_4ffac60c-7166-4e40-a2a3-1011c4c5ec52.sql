
-- 1. Harden dedupe trigger to include context_ref
CREATE OR REPLACE FUNCTION public.dedupe_humor_delivery()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM humor_delivery_events
    WHERE user_id = NEW.user_id
      AND humor_item_id = NEW.humor_item_id
      AND surface = NEW.surface
      AND context_ref IS NOT DISTINCT FROM NEW.context_ref
      AND created_at > now() - interval '60 seconds'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. QC overview view for humor inventory
CREATE OR REPLACE VIEW public.v_admin_humor_qc AS
WITH base AS (
  SELECT
    hi.certification_id,
    c.title AS certification_title,
    hi.status,
    hi.humor_type::text AS humor_type,
    hi.quality_score,
    hi.competence_id,
    hi.lesson_id,
    lower(regexp_replace(hi.text, '[^a-zäöüß0-9 ]', '', 'gi')) AS norm_text
  FROM humor_items hi
  LEFT JOIN certifications c ON c.id = hi.certification_id
),
stats AS (
  SELECT
    certification_id,
    certification_title,
    count(*) AS total,
    count(*) FILTER (WHERE status IN ('approved','frozen')) AS approved_count,
    count(*) FILTER (WHERE status = 'draft') AS draft_count,
    count(*) FILTER (WHERE status = 'rejected') AS rejected_count,
    round(avg(quality_score)::numeric, 2) AS avg_quality,
    round(100.0 * count(*) FILTER (WHERE competence_id IS NULL) / NULLIF(count(*), 0), 1) AS pct_no_competence,
    round(100.0 * count(*) FILTER (WHERE lesson_id IS NULL) / NULLIF(count(*), 0), 1) AS pct_no_lesson
  FROM base
  GROUP BY certification_id, certification_title
),
type_counts AS (
  SELECT
    certification_id,
    jsonb_object_agg(humor_type, cnt) AS type_distribution
  FROM (
    SELECT certification_id, humor_type, count(*) AS cnt
    FROM base
    WHERE status IN ('approved','frozen')
    GROUP BY certification_id, humor_type
  ) t
  GROUP BY certification_id
),
dupes AS (
  SELECT
    certification_id,
    count(*) AS duplicate_suspect_count
  FROM (
    SELECT certification_id, norm_text, count(*) AS c
    FROM base
    WHERE status IN ('approved','frozen')
    GROUP BY certification_id, norm_text
    HAVING count(*) > 1
  ) d
  GROUP BY certification_id
)
SELECT
  s.certification_id,
  s.certification_title,
  s.total,
  s.approved_count,
  s.draft_count,
  s.rejected_count,
  s.avg_quality,
  s.pct_no_competence,
  s.pct_no_lesson,
  COALESCE(tc.type_distribution, '{}'::jsonb) AS type_distribution,
  COALESCE(d.duplicate_suspect_count, 0) AS duplicate_suspect_count
FROM stats s
LEFT JOIN type_counts tc ON tc.certification_id = s.certification_id
LEFT JOIN dupes d ON d.certification_id = s.certification_id
ORDER BY s.approved_count DESC;
