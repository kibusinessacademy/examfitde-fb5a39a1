
CREATE OR REPLACE FUNCTION public.trg_fn_post_publish_learner_e2e()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _supabase_url text;
  _service_key  text;
  _anon_key     text;
BEGIN
  IF (TG_OP = 'UPDATE'
      AND OLD.status IS DISTINCT FROM 'published'
      AND NEW.status = 'published') THEN

    _supabase_url := current_setting('app.settings.supabase_url', true);
    _service_key  := current_setting('app.settings.service_role_key', true);
    _anon_key     := current_setting('app.settings.supabase_anon_key', true);

    IF _supabase_url IS NULL OR _service_key IS NULL THEN
      RAISE LOG '[post-publish-e2e] Skipping: missing app.settings. package_id=%', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := _supabase_url || '/functions/v1/ops-trigger-learner-e2e',
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'x-job-runner-key',  _service_key,
        'apikey',            COALESCE(_anon_key, _service_key)
      ),
      body    := jsonb_build_object(
        'package_id',     NEW.id,
        'curriculum_id',  NEW.curriculum_id,
        'course_id',      COALESCE(NEW.course_id, ''),
        'track',          COALESCE(NEW.track::text, 'EXAM_FIRST'),
        'reason',         'post_publish'
      )
    );

    INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
    VALUES (
      '🧪 Post-Publish E2E gestartet',
      format('Learner Smoke-Test für Paket %s (%s) automatisch ausgelöst.', NEW.title, NEW.id),
      'info',
      'ops',
      'course_package',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_publish_learner_e2e ON public.course_packages;
CREATE TRIGGER trg_post_publish_learner_e2e
  AFTER UPDATE ON public.course_packages
  FOR EACH ROW
  WHEN (NEW.status = 'published')
  EXECUTE FUNCTION public.trg_fn_post_publish_learner_e2e();
