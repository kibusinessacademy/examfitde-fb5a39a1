INSERT INTO public.job_type_policies (job_type, is_repair, can_run_when_not_building, exempt_from_auto_cancel, notes, worker_pool, zombie_timeout_minutes)
VALUES ('seo_intent_page_generate', false, true, true,
        'Loop C3: SEO intent page generation runs against published packages. Whitelisted to bypass NON_BUILDING_PACKAGE auto-cancel.',
        'seo', 30)
ON CONFLICT (job_type) DO UPDATE
SET can_run_when_not_building = EXCLUDED.can_run_when_not_building,
    exempt_from_auto_cancel = EXCLUDED.exempt_from_auto_cancel,
    notes = EXCLUDED.notes,
    worker_pool = EXCLUDED.worker_pool,
    updated_at = now();

UPDATE public.job_queue
SET status = 'pending',
    error = NULL,
    completed_at = NULL,
    updated_at = now()
WHERE job_type = 'seo_intent_page_generate'
  AND status IN ('cancelled','failed')
  AND error ILIKE '%NON_BUILDING_PACKAGE%'
  AND created_at > now() - interval '12 hours';

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('seo_intent_page_generate_whitelisted', 'system', 'ok',
        jsonb_build_object(
          'reason','Wave-1 jobs cancelled by NON_BUILDING_PACKAGE guard; whitelist + revive',
          'wave', 1,
          'revived_jobs', 16
        ));