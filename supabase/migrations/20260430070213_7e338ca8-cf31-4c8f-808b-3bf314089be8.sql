-- ============================================================
-- 1) GUARD: Phantom-Steps auf published Paketen verhindern
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_no_phantom_steps_on_published()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pkg_status text;
BEGIN
  -- Nur INSERT oder Statusänderung in offenen Status prüfen
  IF NEW.status::text NOT IN ('queued','enqueued','pending_enqueue','running') THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT status::text INTO v_pkg_status FROM course_packages WHERE id = NEW.package_id;
  IF v_pkg_status = 'published' THEN
    RAISE EXCEPTION 'guard_no_phantom_steps_on_published: cannot set step % to % on published package %',
      NEW.step_key, NEW.status, NEW.package_id
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_no_phantom_steps_on_published ON public.package_steps;
CREATE TRIGGER trg_guard_no_phantom_steps_on_published
BEFORE INSERT OR UPDATE OF status ON public.package_steps
FOR EACH ROW EXECUTE FUNCTION public.guard_no_phantom_steps_on_published();

-- ============================================================
-- 2) SSOT VIEW: Hidden-Drafts / Hollow-Published auf exam_questions
-- ============================================================
CREATE OR REPLACE VIEW public.v_hidden_hollow_ssot AS
WITH base AS (
  SELECT cp.id as package_id, cp.title, cp.status::text as status, cp.track::text as track,
    cp.curriculum_id, cp.archived,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.qc_status='approved') as approved,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.qc_status='draft') as drafts,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.qc_status='rejected') as rejected,
    (SELECT MAX(eq.created_at) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.qc_status='draft') as last_draft_at
  FROM course_packages cp WHERE cp.archived=false
)
SELECT *,
  CASE
    WHEN status='published' AND approved=0 THEN 'HOLLOW_PUBLISHED'
    WHEN status<>'published' AND drafts>=10 AND approved < drafts THEN 'HIDDEN_DRAFTS'
    ELSE 'OK'
  END as ssot_cluster,
  EXTRACT(DAY FROM (now() - last_draft_at))::int as draft_age_days
FROM base;

-- ============================================================
-- 3) STALE DRAFTS DETECTION VIEW
-- ============================================================
CREATE OR REPLACE VIEW public.v_admin_stale_drafts_detection AS
WITH s AS (
  SELECT cp.id, cp.title, cp.status::text as status, cp.track::text as track, cp.curriculum_id,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id=cp.curriculum_id AND eq.qc_status='draft') as drafts,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id=cp.curriculum_id AND eq.qc_status='approved') as approved,
    (SELECT MAX(eq.created_at) FROM exam_questions eq WHERE eq.curriculum_id=cp.curriculum_id AND eq.qc_status='draft') as last_draft_at,
    (SELECT MAX(ps.updated_at) FROM package_steps ps WHERE ps.package_id=cp.id) as last_step_at,
    (SELECT COUNT(*) FROM job_queue j WHERE j.package_id=cp.id AND j.status IN ('queued','running','claimed')) as active_jobs
  FROM course_packages cp WHERE cp.archived=false
)
SELECT id as package_id, title, status, track, drafts, approved, active_jobs,
  EXTRACT(DAY FROM (now()-last_draft_at))::int as draft_age_days,
  EXTRACT(DAY FROM (now()-last_step_at))::int as step_age_days,
  CASE
    WHEN drafts>=10 AND last_step_at < now() - interval '7 days' AND active_jobs=0 THEN 'STALE_HEAL_NEEDED'
    WHEN drafts>=10 AND last_step_at < now() - interval '3 days' AND active_jobs=0 THEN 'STALE_WATCH'
    ELSE 'OK'
  END as stale_flag
FROM s
WHERE drafts >= 10;

-- ============================================================
-- 4) RPC: admin_heal_stale_drafts (per-package self-heal)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_heal_stale_drafts(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_curr uuid; v_rejected int := 0; v_active int;
BEGIN
  SELECT curriculum_id INTO v_curr FROM course_packages WHERE id = p_package_id;
  IF v_curr IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','package_not_found');
  END IF;

  SELECT COUNT(*) INTO v_active FROM job_queue WHERE package_id=p_package_id
    AND status IN ('queued','running','claimed');
  IF v_active > 0 THEN
    RETURN jsonb_build_object('ok',false,'reason','active_jobs','active_jobs',v_active);
  END IF;

  UPDATE exam_questions SET qc_status='rejected', reviewed_at=now()
  WHERE curriculum_id=v_curr AND qc_status='draft' AND created_at < now() - interval '5 days';
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  -- Re-trigger integrity recheck if step exists
  UPDATE package_steps SET status='queued'::step_status, attempts=0, last_error=NULL,
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('reset_by','admin_heal_stale_drafts','reset_at',now())
  WHERE package_id=p_package_id AND step_key='run_integrity_check' AND status::text IN ('done','failed','blocked');

  INSERT INTO auto_heal_log(action_type,target_type,target_id,metadata,result_status)
  VALUES ('stale_drafts_self_heal','course_package', p_package_id,
    jsonb_build_object('rejected',v_rejected,'curriculum_id',v_curr), 'success');

  RETURN jsonb_build_object('ok',true,'rejected_drafts',v_rejected,'integrity_recheck_queued',true);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_heal_stale_drafts(uuid) TO authenticated;

-- ============================================================
-- 5) HEAL-PLAYBOOK: clustert + heilt
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_heal_playbook_run(p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_hidden_drafts int := 0; v_hollow int := 0; v_phantom int := 0; v_stale int := 0;
  v_actions jsonb := '[]'::jsonb; r RECORD; v_res jsonb;
BEGIN
  -- Cluster A: HIDDEN_DRAFTS (heal per-package)
  FOR r IN SELECT package_id FROM v_hidden_hollow_ssot WHERE ssot_cluster='HIDDEN_DRAFTS' LIMIT 50 LOOP
    v_hidden_drafts := v_hidden_drafts + 1;
    IF NOT p_dry_run THEN
      v_res := public.admin_heal_stale_drafts(r.package_id);
      v_actions := v_actions || jsonb_build_object('cluster','HIDDEN_DRAFTS','pkg',r.package_id,'res',v_res);
    END IF;
  END LOOP;

  -- Cluster B: HOLLOW_PUBLISHED (count only; needs human review/depublish)
  SELECT COUNT(*) INTO v_hollow FROM v_hidden_hollow_ssot WHERE ssot_cluster='HOLLOW_PUBLISHED';

  -- Cluster C: PHANTOM_PUBLISHED (auto-cleanup)
  IF NOT p_dry_run THEN
    PERFORM set_config('session_replication_role','replica',true);
    UPDATE package_steps ps SET status='done'::step_status, finished_at=COALESCE(finished_at,now()),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('phantom_cleanup','heal_playbook_run','cleaned_at',now())
    FROM course_packages cp
    WHERE cp.id=ps.package_id AND cp.status::text='published'
      AND ps.status::text IN ('queued','enqueued','pending_enqueue','running');
    GET DIAGNOSTICS v_phantom = ROW_COUNT;
    PERFORM set_config('session_replication_role','origin',true);
  ELSE
    SELECT COUNT(*) INTO v_phantom FROM package_steps ps JOIN course_packages cp ON cp.id=ps.package_id
      WHERE cp.status::text='published' AND ps.status::text IN ('queued','enqueued','pending_enqueue','running');
  END IF;

  -- Cluster D: STALE_QUEUED (count, leave for staggered cron)
  SELECT COUNT(*) INTO v_stale FROM v_admin_stale_drafts_detection WHERE stale_flag='STALE_HEAL_NEEDED';

  INSERT INTO auto_heal_log(action_type,target_type,metadata,result_status)
  VALUES ('heal_playbook_run','system',
    jsonb_build_object('dry_run',p_dry_run,'hidden_drafts',v_hidden_drafts,'hollow_published',v_hollow,
      'phantom_steps_cleaned',v_phantom,'stale_queued',v_stale,'actions',v_actions),
    CASE WHEN p_dry_run THEN 'noop' ELSE 'success' END);

  RETURN jsonb_build_object('ok',true,'dry_run',p_dry_run,
    'hidden_drafts',v_hidden_drafts,'hollow_published',v_hollow,
    'phantom_steps_cleaned',v_phantom,'stale_queued',v_stale);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_heal_playbook_run(boolean) TO authenticated;
GRANT SELECT ON public.v_hidden_hollow_ssot TO authenticated;
GRANT SELECT ON public.v_admin_stale_drafts_detection TO authenticated;