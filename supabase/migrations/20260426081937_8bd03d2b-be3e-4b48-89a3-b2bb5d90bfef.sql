-- Cancel alle aktiven Phantom-Rebalance-Jobs (kein exam_rebalance Step im Backbone)
WITH cancelled AS (
  UPDATE public.job_queue jq
  SET status = 'cancelled',
      last_error = 'OPS_GUARD_CANCEL: phantom_rebalance_no_step_in_backbone',
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'phantom_rebalance_no_step_in_backbone',
        'cancelled_at', now()::text,
        'cancelled_by', 'phantom_rebalance_cleanup_v2'
      ),
      updated_at = now()
  WHERE jq.job_type = 'package_exam_rebalance'
    AND jq.status IN ('pending','queued','processing','running','batch_pending')
    AND NOT EXISTS (
      SELECT 1 FROM public.package_steps ps
      WHERE ps.package_id = jq.package_id
        AND ps.step_key = 'exam_rebalance'
    )
  RETURNING jq.id, jq.package_id
)
INSERT INTO public.admin_notifications (title, body, category, severity, entity_type)
SELECT
  '🧹 Phantom Rebalance Jobs bereinigt',
  format(
    'Cleanup v2: %s aktive package_exam_rebalance Jobs für Pakete ohne Backbone-Step gecancelt. Pre-Flight-Guard im integrity-check verhindert künftige Erzeugung.',
    (SELECT COUNT(*) FROM cancelled)
  ),
  'pipeline',
  'info',
  'system'
WHERE EXISTS (SELECT 1 FROM cancelled);