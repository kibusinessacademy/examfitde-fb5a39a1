
CREATE TABLE IF NOT EXISTS public.heal_pattern_snoozes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster text NOT NULL,
  target_id text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster, target_id)
);
ALTER TABLE public.heal_pattern_snoozes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read snoozes" ON public.heal_pattern_snoozes;
CREATE POLICY "admin read snoozes" ON public.heal_pattern_snoozes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS idx_heal_pattern_snoozes_expires ON public.heal_pattern_snoozes (expires_at);

CREATE OR REPLACE FUNCTION public.admin_heal_pattern_snooze(p_cluster text, p_target_id text, p_hours int DEFAULT 168, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin'::app_role) THEN RAISE EXCEPTION 'admin only'; END IF;
  INSERT INTO public.heal_pattern_snoozes (cluster, target_id, expires_at, note, created_by)
  VALUES (p_cluster, p_target_id, now()+(p_hours||' hours')::interval, p_note, v_uid)
  ON CONFLICT (cluster, target_id) DO UPDATE
  SET expires_at=EXCLUDED.expires_at, note=EXCLUDED.note, created_by=EXCLUDED.created_by, created_at=now();

  UPDATE public.heal_pattern_recommendations
     SET status='resolved', resolved_at=now(), resolved_by=v_uid, resolved_note=COALESCE(p_note,'snoozed via admin')
   WHERE cluster=p_cluster AND target_id=p_target_id AND status='active';

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('heal_pattern_snoozed','admin_heal_pattern_snooze','pattern', p_target_id,'snoozed',
    jsonb_build_object('cluster',p_cluster,'hours',p_hours,'note',p_note,'admin_uid',v_uid));
  RETURN jsonb_build_object('ok',true,'cluster',p_cluster,'target_id',p_target_id,'expires_at',now()+(p_hours||' hours')::interval);
END; $$;
REVOKE ALL ON FUNCTION public.admin_heal_pattern_snooze(text,text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_pattern_snooze(text,text,int,text) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_heal_recurring_patterns AS
WITH base AS (
  SELECT a.action_type AS cluster, a.target_id, a.target_type, a.created_at,
         a.result_status, a.duration_ms, a.error_message
  FROM auto_heal_log a
  WHERE a.created_at > now() - interval '7 days' AND a.target_id IS NOT NULL
    AND a.action_type NOT IN ('production_guardian_cycle','pipeline_watchdog_cycle','worker_liveness_check',
      'lc_shard_liveness_revive','atomic_step_enqueue','tail_step_retryable_deferred',
      'bronze_locked_enqueue_blocked','reconcile_skipped_bronze_locked','redundant_content_step_enqueue_blocked',
      'heal_pattern_snoozed','manual_zombie_hard_stalled_heal','building_zombie_watchdog_heal')
    AND NOT EXISTS (
      SELECT 1 FROM public.heal_pattern_snoozes s
      WHERE s.cluster=a.action_type AND s.target_id=a.target_id AND s.expires_at>now()
    )
), agg AS (
  SELECT cluster, target_id, max(target_type) target_type,
    count(*) recurrence_7d,
    count(*) FILTER (WHERE created_at>now()-interval '24 hours') recurrence_24h,
    count(*) FILTER (WHERE created_at>now()-interval '1 hour') recurrence_1h,
    count(*) FILTER (WHERE result_status='failed' AND created_at>now()-interval '24 hours') failed_24h,
    min(created_at) first_seen, max(created_at) last_seen,
    mode() WITHIN GROUP (ORDER BY error_message) dominant_error
  FROM base GROUP BY cluster, target_id HAVING count(*)>=3
), scored AS (
  SELECT a.*,
    LEAST(100, round(a.recurrence_7d/50.0*30 + a.recurrence_24h/20.0*30
      + CASE WHEN a.recurrence_1h>=5 THEN 25 ELSE a.recurrence_1h*5 END
      + CASE WHEN a.cluster=ANY(ARRAY['enqueue_phantom_blocked','requeue_loop_mitigation','hot_loop_mitigation','stale_lock_hard_kill','zombie_detected_hard_stalled']) THEN 15 ELSE 0 END)::int) severity_score,
    CASE WHEN a.recurrence_7d>0 THEN round(a.recurrence_24h::numeric/a.recurrence_7d*100,1) ELSE 0 END escalation_rate_pct,
    encode(extensions.digest((a.cluster||'|')||a.target_id,'sha1'),'hex') pattern_key,
    CASE WHEN a.target_id ~ '^[0-9a-f-]{36}$' THEN a.target_id::uuid ELSE NULL END package_id_uuid
  FROM agg a
)
SELECT s.pattern_key, s.cluster, s.target_id, s.target_type,
  s.package_id_uuid AS package_id, cp.title package_title, cp.status package_status, cp.track package_track,
  cp.blocked_reason, cp.last_error AS package_last_error,
  s.recurrence_7d, s.recurrence_24h, s.recurrence_1h, s.failed_24h,
  s.severity_score, s.escalation_rate_pct, s.first_seen, s.last_seen, s.dominant_error,
  rec.id AS active_recommendation_id, rec.confidence recommendation_confidence,
  rec.root_cause recommendation_root_cause, rec.permanent_fix_suggestion recommendation_permanent_fix,
  rec.created_at recommendation_created_at, rec.valid_until recommendation_valid_until
FROM scored s
LEFT JOIN course_packages cp ON cp.id = s.package_id_uuid
LEFT JOIN LATERAL (
  SELECT r.id, r.confidence, r.root_cause, r.permanent_fix_suggestion, r.created_at, r.valid_until
  FROM heal_pattern_recommendations r
  WHERE r.pattern_key=s.pattern_key AND r.status='active' AND r.valid_until>now()
  ORDER BY r.created_at DESC LIMIT 1
) rec ON true
ORDER BY s.severity_score DESC, s.recurrence_24h DESC;

-- BUILDING ZOMBIE WATCHDOG
CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_building_zombies(p_dry_run boolean DEFAULT false, p_min_age_hours int DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count int := 0; v_pkg record; v_healed jsonb := '[]'::jsonb;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.title,
      (SELECT count(*) FROM exam_questions WHERE package_id=cp.id AND status='approved') AS approved_q
    FROM course_packages cp
    WHERE cp.status='building' AND cp.updated_at < now() - (p_min_age_hours||' hours')::interval
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=cp.id AND jq.status IN ('pending','queued','processing','running'))
      AND NOT EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=cp.id AND ps.status NOT IN ('done','skipped'))
  LOOP
    v_count := v_count+1;
    v_healed := v_healed || jsonb_build_object('id',v_pkg.id,'title',v_pkg.title,'approved_q',v_pkg.approved_q);
    IF NOT p_dry_run THEN
      UPDATE course_packages SET status='done', blocked_reason=NULL, blocked_by=NULL, blocked_at=NULL, stuck_reason=NULL, updated_at=now(),
        feature_flags = COALESCE(feature_flags,'{}'::jsonb) || jsonb_build_object(
          'building_zombie_watchdog_heal', jsonb_build_object('healed_at',now(),'approved_q',v_pkg.approved_q))
      WHERE id=v_pkg.id;
      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('building_zombie_watchdog_heal','fn_detect_and_heal_building_zombies','package', v_pkg.id::text,'healed',
        jsonb_build_object('package_id',v_pkg.id,'title',v_pkg.title,'approved_q',v_pkg.approved_q,
                           'reason','no_active_jobs_no_open_steps','min_age_hours',p_min_age_hours));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'detected',v_count,'dry_run',p_dry_run,'healed',v_healed);
END; $$;
REVOKE ALL ON FUNCTION public.fn_detect_and_heal_building_zombies(boolean,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_and_heal_building_zombies(boolean,int) TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('building-zombie-watchdog-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('building-zombie-watchdog-hourly','17 * * * *',
  $cron$ SELECT public.fn_detect_and_heal_building_zombies(false, 2); $cron$);
