
-- 1. Mark BIBB-imported duplicate curricula as superseded
UPDATE curricula SET
  version = '0.0-superseded',
  updated_at = now()
WHERE id IN (
  '8e8f0f32-d21f-4871-a23d-ed1570cc3fa7',
  'bd547ecd-6491-4e1f-a581-b2a9718bfee2',
  '45e6ea8a-6a16-4fa7-94b0-f7707ce53c1c',
  '1f49fe35-ad16-4718-82a1-447b321c42f7',
  'c0f8556b-c29c-48c5-9923-42b4a2c8ea6b',
  'e7e646cf-5f86-4dc3-be1b-380f3eb341fb'
);

-- 2. Fix wrong beruf_id on "Verkufer" typo curriculum
UPDATE curricula SET beruf_id = NULL
WHERE id = '8e8f0f32-d21f-4871-a23d-ed1570cc3fa7';

-- 3. Archive any remaining packages on superseded curricula
UPDATE course_packages SET status = 'archived', updated_at = now()
WHERE curriculum_id IN (
  '8e8f0f32-d21f-4871-a23d-ed1570cc3fa7',
  'bd547ecd-6491-4e1f-a581-b2a9718bfee2',
  '45e6ea8a-6a16-4fa7-94b0-f7707ce53c1c',
  '1f49fe35-ad16-4718-82a1-447b321c42f7',
  'c0f8556b-c29c-48c5-9923-42b4a2c8ea6b',
  'e7e646cf-5f86-4dc3-be1b-380f3eb341fb'
)
AND status NOT IN ('archived','cancelled');

-- 4. Update view to exclude superseded curricula
CREATE OR REPLACE VIEW v_admin_visible_course_packages AS
WITH ranked AS (
  SELECT cp.*,
    row_number() OVER (
      PARTITION BY cp.curriculum_id
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
  JOIN curricula c ON c.id = cp.curriculum_id
  WHERE cp.status <> 'archived'
    AND cp.curriculum_id IS NOT NULL
    AND coalesce(c.version, '') <> '0.0-superseded'
)
SELECT * FROM ranked WHERE rn = 1;
