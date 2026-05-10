-- Persist provider/model on minicheck generate+repair jobs so
-- v_minicheck_rejection_clusters.last_repair_provider/_model fill consistently.

-- 1) BEFORE INSERT/UPDATE trigger on job_queue
CREATE OR REPLACE FUNCTION public.fn_stamp_minicheck_provider_model()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_audit_model text;
BEGIN
  IF NEW.job_type NOT IN ('package_repair_lesson_minichecks',
                          'package_generate_lesson_minichecks') THEN
    RETURN NEW;
  END IF;

  IF NEW.provider IS NULL THEN
    NEW.provider := 'openai';
  END IF;

  IF NEW.payload IS NULL THEN
    NEW.payload := '{}'::jsonb;
  END IF;

  IF (NEW.payload->>'model') IS NULL OR length(NEW.payload->>'model') = 0 THEN
    SELECT mal.model INTO v_audit_model
    FROM public.minicheck_audit_log mal
    JOIN public.course_packages cp ON cp.curriculum_id = mal.curriculum_id
    WHERE cp.id = NEW.package_id AND mal.model IS NOT NULL
    ORDER BY mal.completed_at DESC NULLS LAST
    LIMIT 1;

    NEW.payload := NEW.payload
      || jsonb_build_object('model', COALESCE(v_audit_model, 'gpt-4o-mini'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_minicheck_provider_model ON public.job_queue;
CREATE TRIGGER trg_stamp_minicheck_provider_model
BEFORE INSERT OR UPDATE OF status, payload, provider ON public.job_queue
FOR EACH ROW
WHEN (NEW.job_type IN ('package_repair_lesson_minichecks',
                       'package_generate_lesson_minichecks'))
EXECUTE FUNCTION public.fn_stamp_minicheck_provider_model();

-- 2) Backfill existing rows (provider + payload.model)
WITH cur_model AS (
  SELECT DISTINCT ON (cp.id) cp.id AS package_id, mal.model
  FROM public.course_packages cp
  LEFT JOIN public.minicheck_audit_log mal ON mal.curriculum_id = cp.curriculum_id
  WHERE mal.model IS NOT NULL
  ORDER BY cp.id, mal.completed_at DESC NULLS LAST
)
UPDATE public.job_queue jq
SET provider = COALESCE(jq.provider, 'openai'),
    payload  = CASE
      WHEN (jq.payload->>'model') IS NULL OR length(jq.payload->>'model') = 0
        THEN COALESCE(jq.payload, '{}'::jsonb)
             || jsonb_build_object('model',
                  COALESCE(cm.model, 'gpt-4o-mini'))
      ELSE jq.payload
    END
FROM (SELECT id FROM public.job_queue
      WHERE job_type IN ('package_repair_lesson_minichecks',
                         'package_generate_lesson_minichecks')) j
LEFT JOIN cur_model cm ON cm.package_id = (SELECT package_id FROM public.job_queue WHERE id = j.id)
WHERE jq.id = j.id
  AND (jq.provider IS NULL
       OR (jq.payload->>'model') IS NULL
       OR length(jq.payload->>'model') = 0);

-- 3) Audit
INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
VALUES('minicheck_provider_model_backfill','system',NULL,'applied',
  jsonb_build_object('trigger','trg_stamp_minicheck_provider_model','at',now()));
