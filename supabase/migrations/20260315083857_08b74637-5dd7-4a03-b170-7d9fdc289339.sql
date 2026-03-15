
-- Drop and recreate view to fix column mismatch
DROP VIEW IF EXISTS public.v_admin_visible_course_packages CASCADE;

CREATE VIEW public.v_admin_visible_course_packages AS
WITH ranked AS (
  SELECT cp.*,
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
        cp.priority,
        cp.updated_at DESC,
        cp.created_at DESC,
        cp.id DESC
    ) AS rn
  FROM course_packages cp
  JOIN curricula cu ON cu.id = cp.curriculum_id
  WHERE cp.status <> 'archived'
    AND cp.curriculum_id IS NOT NULL
    AND coalesce(cu.version, '') <> '0.0-superseded'
)
SELECT * FROM ranked WHERE rn = 1;

COMMENT ON VIEW public.v_admin_visible_course_packages IS
  'SSOT admin listing: exactly one visible package per canonical beruf_id. Falls back to curriculum_id if beruf_id is NULL.';
