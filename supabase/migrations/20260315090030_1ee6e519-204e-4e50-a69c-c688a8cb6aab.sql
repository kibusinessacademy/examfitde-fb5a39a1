
-- 1) Backfill: re-canonicalize titles from SSOT berufe.bezeichnung_kurz
UPDATE public.course_packages cp
SET title = b.bezeichnung_kurz,
    updated_at = now()
FROM public.curricula cu
JOIN public.berufe b ON b.id = cu.beruf_id
WHERE cu.id = cp.curriculum_id
  AND b.bezeichnung_kurz IS NOT NULL
  AND b.bezeichnung_kurz <> ''
  AND cp.status NOT IN ('archived', 'cancelled');

-- 2) Archive remaining duplicates per beruf_id
WITH beruf_ranked AS (
  SELECT cp.id,
    cu.beruf_id,
    row_number() OVER (
      PARTITION BY cu.beruf_id
      ORDER BY
        CASE cp.status
          WHEN 'building' THEN 1
          WHEN 'queued' THEN 2
          WHEN 'failed' THEN 3
          WHEN 'planning' THEN 4
          WHEN 'draft' THEN 5
          WHEN 'published' THEN 6
          WHEN 'done' THEN 7
          ELSE 99
        END,
        cp.priority ASC NULLS LAST,
        cp.updated_at DESC,
        cp.created_at DESC,
        cp.id DESC
    ) AS rn
  FROM public.course_packages cp
  JOIN public.curricula cu ON cu.id = cp.curriculum_id
  WHERE cp.status NOT IN ('archived', 'cancelled')
    AND cp.curriculum_id IS NOT NULL
    AND cu.beruf_id IS NOT NULL
    AND coalesce(cu.version, '') <> '0.0-superseded'
)
UPDATE public.course_packages
SET status = 'archived', updated_at = now()
WHERE id IN (SELECT id FROM beruf_ranked WHERE rn > 1)
  AND status NOT IN ('archived', 'cancelled', 'building', 'published');

-- 3) Recreate view with canonical_title from berufe
DROP VIEW IF EXISTS public.v_admin_visible_course_packages;

CREATE VIEW public.v_admin_visible_course_packages AS
WITH ranked AS (
  SELECT
    cp.*,
    cu.beruf_id,
    COALESCE(b.bezeichnung_kurz, b.bezeichnung_lang, cp.title) AS canonical_title,
    row_number() OVER (
      PARTITION BY COALESCE(cu.beruf_id::text, cp.curriculum_id::text)
      ORDER BY
        CASE cp.status
          WHEN 'building' THEN 1
          WHEN 'queued' THEN 2
          WHEN 'failed' THEN 3
          WHEN 'planning' THEN 4
          WHEN 'draft' THEN 5
          WHEN 'published' THEN 6
          WHEN 'done' THEN 7
          ELSE 99
        END,
        cp.priority ASC NULLS LAST,
        cp.updated_at DESC,
        cp.created_at DESC,
        cp.id DESC
    ) AS rn
  FROM public.course_packages cp
  JOIN public.curricula cu ON cu.id = cp.curriculum_id
  LEFT JOIN public.berufe b ON b.id = cu.beruf_id
  WHERE cp.status <> 'archived'
    AND cp.curriculum_id IS NOT NULL
    AND coalesce(cu.version, '') <> '0.0-superseded'
)
SELECT * FROM ranked WHERE rn = 1;

COMMENT ON VIEW public.v_admin_visible_course_packages IS
  'SSOT admin listing: one package per beruf_id, canonical_title from berufe.bezeichnung_kurz.';
