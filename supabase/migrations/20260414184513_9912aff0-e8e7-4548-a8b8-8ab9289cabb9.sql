
UPDATE package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'done_reason', 'redundant_seeding_backfill',
      'auto_completed_at', now()
    )
WHERE step_key = 'auto_seed_exam_blueprints'
  AND status = 'queued'
  AND package_id IN (
    SELECT cp.id FROM course_packages cp
    WHERE cp.status = 'building'
      AND EXISTS (
        SELECT 1 FROM question_blueprints qb
        WHERE qb.curriculum_id = cp.curriculum_id
          AND qb.status IN ('approved', 'review')
        HAVING count(*) >= 10
      )
  );
