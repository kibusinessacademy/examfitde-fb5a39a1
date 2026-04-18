-- B1: enqueue_job_if_absent transparent
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_priority integer DEFAULT 0,
  p_max_attempts integer DEFAULT 25,
  p_run_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, created boolean, duplicate boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_step_key text; v_existing record; v_new_id uuid;
  v_recent_completed_count int; v_step_status text; v_mapped_step text;
  v_active_count int; v_is_incremental_dispatcher boolean;
  v_fanout_cap int; v_zero_progress_threshold int;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');
  v_is_incremental_dispatcher := p_job_type IN (
    'package_generate_learning_content','package_finalize_learning_content',
    'package_generate_handbook','package_generate_lesson_minichecks',
    'package_enqueue_handbook_expand','package_fanout_learning_content'
  );
  v_fanout_cap := CASE WHEN v_is_incremental_dispatcher THEN 5 ELSE 3 END;
  v_zero_progress_threshold := CASE WHEN v_is_incremental_dispatcher THEN 8 ELSE 3 END;

  select jq.id, jq.status into v_existing from public.job_queue jq
  where jq.job_type = p_job_type
    and coalesce(jq.package_id::text,'') = coalesce(p_package_id::text,'')
    and coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    and jq.status in ('pending','queued','processing','running','batch_pending')
  order by jq.created_at desc limit 1;
  if found then
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_dedupe','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Duplicate active job for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,'existing_id',v_existing.id,'existing_status',v_existing.status));
    return query select v_existing.id, false, true, 'duplicate_active'::text; return;
  end if;

  if p_package_id is not null then
    select count(*) into v_active_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status in ('pending','queued','processing','running','batch_pending');
    if v_active_count >= v_fanout_cap then
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_fanout_cap','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Fanout cap reached for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'active_count',v_active_count,'cap',v_fanout_cap));
      return query select NULL::uuid, false, false, 'fanout_capped'::text; return;
    end if;
  end if;

  if p_package_id is not null then
    select count(*) into v_recent_completed_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status='completed' and jq.updated_at > now() - interval '2 hours';
    if v_recent_completed_count >= v_zero_progress_threshold then
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');
      select ps.status::text into v_step_status from public.package_steps ps
      where ps.package_id = p_package_id and ps.step_key = v_mapped_step limit 1;
      if v_step_status is not null and v_step_status not in ('done','skipped') then
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('enqueue_zero_progress','enqueue_job_if_absent','job',p_package_id::text,'rejected',
                'Zero-progress block for '||p_job_type,
                jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'completed_2h',v_recent_completed_count,'threshold',v_zero_progress_threshold,'step_status',v_step_status));
        return query select NULL::uuid, false, false, 'zero_progress_blocked'::text; return;
      end if;
    end if;
  end if;

  insert into public.job_queue (job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at)
  values (p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after, p_payload, p_payload, now(), now())
  returning job_queue.id into v_new_id;
  return query select v_new_id, true, false, 'pending'::text;
end;
$function$;

-- B2: ZERTIFIKAT in track_step_applicability (track_kind ist product_track)
INSERT INTO track_step_applicability (track, step_key, should_run, condition)
SELECT t.track::product_track, s.step_key, true, 'B2: ZERTIFIKAT lerninhalts-faehig'
FROM (VALUES ('ZERTIFIKAT'::text)) AS t(track)
CROSS JOIN (VALUES 
  ('generate_learning_content'::text),
  ('fanout_learning_content'::text),
  ('finalize_learning_content'::text),
  ('validate_learning_content'::text)
) AS s(step_key)
ON CONFLICT (track, step_key) DO UPDATE SET should_run = true, condition = EXCLUDED.condition;

-- B3: Hollow-Guard inline ohne realness view
CREATE OR REPLACE FUNCTION public.fn_trigger_sync_step_on_job_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_step_key text;
  v_step_map jsonb := '{
    "package_generate_learning_content": "generate_learning_content",
    "package_fanout_learning_content": "fanout_learning_content",
    "package_finalize_learning_content": "finalize_learning_content",
    "package_validate_learning_content": "validate_learning_content",
    "package_generate_exam_pool": "generate_exam_pool",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_generate_handbook": "generate_handbook",
    "package_validate_handbook": "validate_handbook",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_validate_oral_exam": "validate_oral_exam",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_validate_lesson_minichecks": "validate_lesson_minichecks",
    "package_validate_tutor_index": "validate_tutor_index",
    "package_validate_blueprints": "validate_blueprints",
    "package_run_integrity_check": "run_integrity_check"
  }'::jsonb;
  v_total_lessons int := 0;
  v_real_lessons int := 0;
  v_placeholder_lessons int := 0;
  v_substantive_ratio numeric := 0;
  v_is_hollow boolean := false;
  v_lc_steps text[] := ARRAY['generate_learning_content','fanout_learning_content','finalize_learning_content','validate_learning_content'];
BEGIN
  IF NEW.status NOT IN ('completed','done') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  v_step_key := v_step_map->>NEW.job_type;
  IF v_step_key IS NULL OR NEW.package_id IS NULL THEN RETURN NEW; END IF;

  IF v_step_key = ANY(v_lc_steps) THEN
    SELECT 
      COUNT(*),
      COUNT(*) FILTER (
        WHERE l.content IS NOT NULL 
          AND jsonb_typeof(l.content) = 'object'
          AND COALESCE(length(l.content::text), 0) >= 800
          AND COALESCE(l.generation_status, 'pending') NOT IN ('pending','placeholder','failed')
      ),
      COUNT(*) FILTER (
        WHERE l.content IS NULL 
          OR COALESCE(length(l.content::text), 0) < 200
          OR COALESCE(l.generation_status, 'pending') IN ('pending','placeholder')
      )
    INTO v_total_lessons, v_real_lessons, v_placeholder_lessons
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    JOIN curriculum c ON c.id = m.curriculum_id
    JOIN course_packages cp ON cp.curriculum_id = c.id
    WHERE cp.id = NEW.package_id;

    IF v_total_lessons > 0 THEN
      v_substantive_ratio := v_real_lessons::numeric / v_total_lessons::numeric;
      v_is_hollow := (v_placeholder_lessons > 0) OR (v_substantive_ratio < 0.90);
    END IF;

    IF v_is_hollow AND v_total_lessons > 0 THEN
      UPDATE package_steps ps
      SET status = 'queued'::step_status,
          last_error = format('B3 Hollow-Guard: %s/%s real, %s placeholders, ratio=%.2f', 
                              v_real_lessons, v_total_lessons, v_placeholder_lessons, v_substantive_ratio),
          meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
            'allow_regression', true,
            'allow_regression_by', 'b3_hollow_guard_revoke',
            'hollow_total', v_total_lessons,
            'hollow_real', v_real_lessons,
            'hollow_placeholders', v_placeholder_lessons,
            'hollow_ratio', v_substantive_ratio,
            'hollow_detected_at', now()
          ),
          updated_at = now()
      WHERE ps.package_id = NEW.package_id
        AND ps.step_key = v_step_key
        AND ps.status::text IN ('queued','failed','enqueued','running','done','skipped','pending_enqueue');

      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('b3_hollow_revoke','fn_trigger_sync_step_on_job_complete','package_step',NEW.package_id::text,'reverted',
              format('Step %s reverted to queued (hollow: %s/%s real)', v_step_key, v_real_lessons, v_total_lessons),
              jsonb_build_object('job_id',NEW.id,'job_type',NEW.job_type,'step_key',v_step_key,'total',v_total_lessons,'real',v_real_lessons,'placeholders',v_placeholder_lessons,'ratio',v_substantive_ratio));
      RETURN NEW;
    END IF;
  END IF;

  UPDATE package_steps
  SET status = 'done'::step_status, updated_at = now()
  WHERE package_id = NEW.package_id AND step_key = v_step_key
    AND status::text IN ('queued','enqueued','running','pending_enqueue');
  RETURN NEW;
END;
$function$;