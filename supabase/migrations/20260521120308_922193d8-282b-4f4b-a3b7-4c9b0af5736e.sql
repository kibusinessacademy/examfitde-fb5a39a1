
-- Register intent contracts (idempotent insert)
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('system_intent_phase_2b_cutover', ARRAY['migrated_crons','intent_types']::text[], 'system_intents_phase_2b')
ON CONFLICT (action_type) DO UPDATE SET required_keys = EXCLUDED.required_keys, owner_module = EXCLUDED.owner_module;

-- Unschedule old direct-HTTP cron jobs
SELECT cron.unschedule('production-guardian-5min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='production-guardian-5min');
SELECT cron.unschedule('exam-pool-loop-breaker-5min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='exam-pool-loop-breaker-5min');

-- Reschedule via system_intents (no http key needed → migration-safe)
SELECT cron.schedule(
  'production-guardian-5min',
  '*/5 * * * *',
  $$SELECT public.cron_record_tick_intent('production_guardian_tick', 'cron:production-guardian-5min');$$
);

SELECT cron.schedule(
  'exam-pool-loop-breaker-5min',
  '*/5 * * * *',
  $$SELECT public.cron_record_tick_intent('exam_pool_loop_breaker_tick', 'cron:exam-pool-loop-breaker-5min');$$
);

-- Cutover audit
DO $$
BEGIN
  PERFORM public.fn_emit_audit(
    _action_type := 'system_intent_phase_2b_cutover',
    _target_type := 'system',
    _target_id := NULL,
    _result_status := 'success',
    _payload := jsonb_build_object(
      'migrated_crons', ARRAY['production-guardian-5min','exam-pool-loop-breaker-5min'],
      'intent_types', ARRAY['production_guardian_tick','exam_pool_loop_breaker_tick']
    ),
    _trigger_source := 'migration_phase_2b',
    _error_message := NULL
  );
END $$;
