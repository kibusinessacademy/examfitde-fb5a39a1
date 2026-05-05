
-- 1) Test-Learner Auto-Provision in admin_create_test_purchase_grant
CREATE OR REPLACE FUNCTION public.admin_create_test_purchase_grant(
  _course_id uuid,
  _user_email text,
  _reason text DEFAULT 'manual_test'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_curriculum_id uuid;
  v_grant_id uuid;
  v_created boolean := false;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
         OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM public.courses WHERE id = _course_id;
  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = _user_email LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Auto-provision: only allow auto-create for *@examfit-smoke.local addresses
    IF _user_email NOT LIKE '%@examfit-smoke.local' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'user_not_found',
        'hint', 'auto-provision only enabled for *@examfit-smoke.local addresses');
    END IF;

    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      _user_email,
      crypt(encode(gen_random_bytes(24),'hex'), gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider','email','providers',ARRAY['email']),
      jsonb_build_object('source','admin_test_grant_autoprovision')
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_user_id,
            jsonb_build_object('sub', v_user_id::text, 'email', _user_email),
            'email', v_user_id::text, now(), now(), now())
    ON CONFLICT DO NOTHING;

    BEGIN
      INSERT INTO public.profiles (user_id, email, display_name)
      VALUES (v_user_id, _user_email, split_part(_user_email,'@',1))
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (v_user_id, 'learner') ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_created := true;

    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('test_learner_autoprovisioned','user', v_user_id::text, 'success',
      jsonb_build_object('email', _user_email, 'reason', _reason));
  END IF;

  v_grant_id := public.grant_learner_course_access(
    v_user_id, v_curriculum_id, 'test_purchase', _reason
  );

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('test_purchase_grant_created','user', v_user_id::text, 'success',
    jsonb_build_object('email', _user_email, 'course_id', _course_id,
                       'curriculum_id', v_curriculum_id, 'grant_id', v_grant_id,
                       'user_autoprovisioned', v_created, 'reason', _reason));

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant_id,
    'user_id', v_user_id, 'user_autoprovisioned', v_created,
    'course_id', _course_id, 'curriculum_id', v_curriculum_id);
END $$;

-- 2) Auto-promote: lower threshold to lessons_ready >= 100
CREATE OR REPLACE FUNCTION public.admin_auto_promote_ready_courses(_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_promoted int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
         OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  FOR v_row IN
    SELECT v.course_id, v.title, v.lessons_ready, v.minichecks_total,
           p.id AS product_id, p.visibility
      FROM public.v_admin_course_pipeline_readiness v
      JOIN public.courses c ON c.id = v.course_id
      JOIN public.products p ON p.curriculum_id = c.curriculum_id AND p.status='active'
     WHERE v.course_status = 'published'
       AND v.lessons_ready  >= 100
       AND v.minichecks_total > 10
       AND v.pending_jobs = 0
       AND v.failed_jobs  = 0
       AND p.visibility = 'private'
       AND EXISTS (SELECT 1 FROM public.product_prices pp
                    WHERE pp.product_id=p.id AND pp.active=true AND pp.stripe_price_id IS NOT NULL)
  LOOP
    IF _dry_run THEN
      v_results := v_results || jsonb_build_object('course_id', v_row.course_id, 'title', v_row.title,
        'product_id', v_row.product_id, 'lessons_ready', v_row.lessons_ready, 'would_promote', true);
      CONTINUE;
    END IF;

    UPDATE public.products SET visibility='public', updated_at=now() WHERE id=v_row.product_id;
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES ('launch_auto_promote','product', v_row.product_id, 'success',
            jsonb_build_object('course_id', v_row.course_id, 'title', v_row.title,
                               'lessons_ready', v_row.lessons_ready,
                               'minichecks_total', v_row.minichecks_total,
                               'old_visibility','private','new_visibility','public',
                               'reason','meets_launch_thresholds_v2 (lessons_ready>=100)'));
    v_promoted := v_promoted + 1;
    v_results := v_results || jsonb_build_object('course_id', v_row.course_id, 'title', v_row.title,
      'product_id', v_row.product_id, 'lessons_ready', v_row.lessons_ready, 'promoted', true);
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('launch_auto_promote_run','system','success',
          jsonb_build_object('promoted', v_promoted, 'dry_run', _dry_run, 'threshold','lessons_ready>=100'));

  RETURN jsonb_build_object('ok', true, 'promoted', v_promoted, 'dry_run', _dry_run, 'results', v_results);
END $$;

-- 3) Reschedule crons to */5
SELECT cron.unschedule('auto-promote-ready-courses-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='auto-promote-ready-courses-hourly');
SELECT cron.unschedule('auto-promote-ready-courses-5min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='auto-promote-ready-courses-5min');
SELECT cron.schedule(
  'auto-promote-ready-courses-5min', '*/5 * * * *',
  $$ SELECT public.admin_auto_promote_ready_courses(false); $$
);

SELECT cron.unschedule('completion-burst-5min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='completion-burst-5min');
SELECT cron.unschedule('completion-burst-15min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='completion-burst-15min');
SELECT cron.schedule(
  'completion-burst-5min', '*/5 * * * *',
  $$ SELECT public.admin_completion_burst(25); $$
);

-- Immediate kick
SELECT public.admin_auto_promote_ready_courses(false);
SELECT public.admin_completion_burst(25);
