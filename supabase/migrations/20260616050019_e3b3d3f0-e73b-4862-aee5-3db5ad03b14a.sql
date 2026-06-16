CREATE OR REPLACE FUNCTION public.fn_enqueue_pillar_ensure_on_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    INSERT INTO public.job_queue (job_type, status, payload, job_name, correlation_id, root_job_id, package_id)
    SELECT 'package_seo_pillar_ensure', 'pending',
      jsonb_build_object('package_id', NEW.id, 'curriculum_id', NEW.curriculum_id, 'enqueue_source','publish_transition'),
      'package_seo_pillar_ensure', gen_random_uuid(), gen_random_uuid(), NEW.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id=NEW.id AND jq.job_type='package_seo_pillar_ensure'
        AND jq.status IN ('pending','queued','processing')
    );
  END IF;
  RETURN NEW;
END;
$function$;