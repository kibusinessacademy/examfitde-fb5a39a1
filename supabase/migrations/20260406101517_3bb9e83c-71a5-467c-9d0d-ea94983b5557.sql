
-- Audit view: blocked Prio-1+ packages with admin_hold older than 24h
CREATE OR REPLACE VIEW public.v_ops_stale_admin_holds AS
SELECT cp.id as package_id, cp.title, cp.track, cp.priority, cp.status,
  cp.blocked_reason, cp.updated_at as blocked_since,
  EXTRACT(EPOCH FROM (now() - cp.updated_at)) / 3600 as hours_blocked
FROM course_packages cp
WHERE cp.status = 'blocked'
  AND cp.blocked_reason IS NOT NULL
  AND cp.blocked_reason LIKE '%admin_hold%'
  AND cp.updated_at < now() - interval '24 hours'
ORDER BY cp.priority ASC, cp.updated_at ASC;

-- Function: auto-create admin notifications for stale holds (called by watchdog cron)
CREATE OR REPLACE FUNCTION public.fn_alert_stale_admin_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT package_id, title, priority, hours_blocked
    FROM v_ops_stale_admin_holds
    WHERE hours_blocked > 48
    AND NOT EXISTS (
      SELECT 1 FROM admin_notifications an
      WHERE an.entity_id = v_ops_stale_admin_holds.package_id::text
        AND an.category = 'stale_admin_hold'
        AND an.created_at > now() - interval '24 hours'
    )
    LIMIT 10
  LOOP
    INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id)
    VALUES (
      format('Stale Admin Hold: %s (Prio %s)', v_rec.title, v_rec.priority),
      format('Package %s is on admin_hold for %.0f hours. Review and release or archive.', v_rec.package_id, v_rec.hours_blocked),
      'stale_admin_hold', 'warning', 'course_package', v_rec.package_id::text
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
