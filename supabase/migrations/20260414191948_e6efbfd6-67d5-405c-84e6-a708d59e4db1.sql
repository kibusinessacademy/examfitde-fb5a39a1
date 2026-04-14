
WITH sufficient_packages AS (
  SELECT cp.id AS package_id, cp.curriculum_id,
    (SELECT count(*) FROM question_blueprints qb 
     WHERE qb.curriculum_id = cp.curriculum_id AND qb.status IN ('approved', 'review')) AS bp_count
  FROM course_packages cp
  WHERE cp.status = 'building'
),
eligible AS (
  SELECT sp.package_id, sp.bp_count
  FROM sufficient_packages sp
  WHERE sp.bp_count >= 10
)
UPDATE package_steps ps
SET status = 'done',
    started_at = now(),
    updated_at = now(),
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'done_reason', 'redundant_seeding_backfill_v2',
      'existing_blueprints', e.bp_count,
      'auto_completed_at', now()::text
    )
FROM eligible e
WHERE ps.package_id = e.package_id
  AND ps.step_key IN ('generate_blueprint_variants', 'validate_blueprint_variants', 'promote_blueprint_variants')
  AND ps.status IN ('queued', 'enqueued');
