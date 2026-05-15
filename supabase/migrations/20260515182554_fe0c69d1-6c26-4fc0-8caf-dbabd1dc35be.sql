-- 1) Harden admin_seo_wave_enqueue_one with post-insert verify
CREATE OR REPLACE FUNCTION public.admin_seo_wave_enqueue_one(
  p_curriculum_id uuid, p_competency_id uuid, p_package_id uuid,
  p_intent_key text, p_persona_type text DEFAULT 'azubi',
  p_wave integer DEFAULT NULL, p_priority_queue_id uuid DEFAULT NULL,
  p_enqueue_source text DEFAULT 'admin_seo_wave_enqueue_one',
  p_priority integer DEFAULT 5, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_intent_norm     text;
  v_intent_template text;
  v_idem            text;
  v_active_job      uuid;
  v_existing_idem   uuid;
  v_new_job_id      uuid;
  v_inserted_id     uuid;
  v_corr_id         uuid := gen_random_uuid();
  v_payload         jsonb;
  v_result          jsonb;
  v_attempt_audit_id uuid := gen_random_uuid();
BEGIN
  IF p_curriculum_id IS NULL OR p_competency_id IS NULL OR p_package_id IS NULL OR p_intent_key IS NULL THEN
    v_result := jsonb_build_object('status','error','reason','MISSING_REQUIRED_INPUT',
      'inputs', jsonb_build_object('curriculum_id', p_curriculum_id, 'competency_id', p_competency_id,
        'package_id', p_package_id, 'intent_key', p_intent_key));
    INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
    VALUES (v_attempt_audit_id, 'seo_wave_enqueue_attempt', 'seo_wave', p_package_id, 'error', v_result);
    RETURN v_result;
  END IF;

  v_intent_norm := CASE WHEN p_intent_key LIKE 'intent\_%' ESCAPE '\' THEN substring(p_intent_key from 8) ELSE p_intent_key END;
  v_intent_template := 'intent_' || v_intent_norm;
  v_idem := 'seo_wave|' || p_package_id || '|' || p_competency_id || '|' || v_intent_norm || '|' || COALESCE(p_persona_type,'azubi');

  SELECT id INTO v_active_job FROM job_queue
  WHERE job_type = 'seo_intent_page_generate'
    AND status IN ('pending','processing')
    AND package_id = p_package_id
    AND payload->>'competency_id' = p_competency_id::text
    AND payload->>'intent_template' = v_intent_template
    AND COALESCE(payload->>'persona_type','azubi') = COALESCE(p_persona_type,'azubi')
  ORDER BY created_at DESC LIMIT 1;

  IF v_active_job IS NOT NULL THEN
    v_result := jsonb_build_object('status','skipped_active_job','job_id', v_active_job, 'idempotency_key', v_idem);
    INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
    VALUES (v_attempt_audit_id, 'seo_wave_enqueue_attempt', 'seo_wave', p_package_id, 'skipped', v_result);
    RETURN v_result;
  END IF;

  SELECT id INTO v_existing_idem FROM job_queue
  WHERE idempotency_key = v_idem AND status IN ('pending','processing') LIMIT 1;
  IF v_existing_idem IS NOT NULL THEN
    v_result := jsonb_build_object('status','skipped_idempotent','job_id', v_existing_idem,'idempotency_key', v_idem);
    INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
    VALUES (v_attempt_audit_id, 'seo_wave_enqueue_attempt', 'seo_wave', p_package_id, 'skipped', v_result);
    RETURN v_result;
  END IF;

  v_payload := jsonb_build_object(
    'curriculum_id', p_curriculum_id, 'competency_id', p_competency_id, 'package_id', p_package_id,
    'intent_template', v_intent_template, 'persona_type', COALESCE(p_persona_type,'azubi'),
    'wave', p_wave, 'priority_queue_id', p_priority_queue_id, 'enqueue_source', p_enqueue_source,
    'learning_field_filter', v_intent_template || ':' || left(p_competency_id::text, 8));

  IF p_dry_run THEN
    v_result := jsonb_build_object('status','dry_run','idempotency_key', v_idem,'payload_preview', v_payload);
    INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
    VALUES (v_attempt_audit_id, 'seo_wave_enqueue_attempt', 'seo_wave', p_package_id, 'dry_run', v_result);
    RETURN v_result;
  END IF;

  v_new_job_id := gen_random_uuid();

  -- POST-INSERT VERIFY: capture RETURNING. If a BEFORE-INSERT trigger returned NULL,
  -- v_inserted_id will be NULL even though no exception fired.
  INSERT INTO job_queue (
    id, job_type, status, payload, package_id, worker_pool, lane,
    priority, idempotency_key, correlation_id, root_job_id, job_name, meta)
  VALUES (
    v_new_job_id, 'seo_intent_page_generate', 'pending', v_payload, p_package_id,
    'seo','generation', p_priority, v_idem, v_corr_id, v_new_job_id,
    'seo_intent_page_generate:' || v_intent_norm,
    jsonb_build_object('enqueue_source', p_enqueue_source, 'wave', p_wave,
      'enqueued_via', 'admin_seo_wave_enqueue_one'))
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    -- Silent drop — a BEFORE INSERT trigger returned NULL without raising
    v_result := jsonb_build_object('status','silent_drop',
      'reason','BEFORE_INSERT_TRIGGER_RETURNED_NULL',
      'attempted_job_id', v_new_job_id, 'idempotency_key', v_idem,
      'payload', v_payload, 'curriculum_id', p_curriculum_id,
      'competency_id', p_competency_id, 'intent_template', v_intent_template);
    INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
    VALUES (v_attempt_audit_id, 'seo_wave_enqueue_attempt', 'seo_wave', p_package_id, 'silent_drop', v_result);
    RETURN v_result;
  END IF;

  IF p_priority_queue_id IS NOT NULL THEN
    UPDATE seo_content_priority_queue
       SET last_enqueued_at = now(), generation_status = 'queued',
           job_id = v_new_job_id, updated_at = now()
     WHERE id = p_priority_queue_id;
  END IF;

  v_result := jsonb_build_object('status','enqueued','job_id', v_new_job_id,
    'idempotency_key', v_idem, 'correlation_id', v_corr_id);
  INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
  VALUES (v_attempt_audit_id, 'seo_wave_enqueue_attempt', 'seo_wave', p_package_id, 'enqueued', v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  v_result := jsonb_build_object('status','error','reason','EXCEPTION',
    'sqlstate', SQLSTATE,'message', SQLERRM);
  BEGIN
    INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
    VALUES (gen_random_uuid(), 'seo_wave_enqueue_attempt', 'seo_wave', p_package_id, 'error', v_result);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN v_result;
END;
$function$;

-- 2) Audit-mirror: backfill silent-drop verdicts for the 16 phantom audits from 17:26 + 18:02 batches
INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
SELECT 'seo_wave_silent_drop_backfill', 'seo_wave',
       a.target_id, 'silent_drop',
       jsonb_build_object('original_audit_id', a.id,
                          'original_at', a.created_at,
                          'idempotency_key', a.metadata->>'idempotency_key',
                          'claimed_job_id', a.metadata->>'job_id',
                          'reason', 'BACKFILL_VERIFIED_NEVER_INSERTED')
FROM auto_heal_log a
WHERE a.action_type = 'seo_wave_enqueue_attempt'
  AND a.result_status = 'enqueued'
  AND a.created_at > now() - interval '24 hours'
  AND (a.metadata->>'job_id') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.id = (a.metadata->>'job_id')::uuid
  );