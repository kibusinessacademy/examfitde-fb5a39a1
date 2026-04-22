-- Self-Heal Loop v1 — Bulk-BP-Heal Aftermath:
-- After 4349 fresh blueprints landed across 51 packages, requeue
-- failed validate_exam_pool steps so the pipeline picks them up again.
UPDATE package_steps ps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb)
         || jsonb_build_object('requeued_by','bulk_bp_heal_v1','requeued_at', now())
FROM course_packages cp
WHERE ps.package_id = cp.id
  AND ps.step_key = 'validate_exam_pool'
  AND ps.status = 'failed'
  AND cp.status IN ('blocked','building','failed','paused')
  AND COALESCE(cp.blocked_reason,'') <> 'auto_heal_zombie';