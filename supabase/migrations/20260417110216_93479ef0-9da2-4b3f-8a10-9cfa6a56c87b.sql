DO $$
DECLARE
  v_jobname text;
  v_count int := 0;
BEGIN
  FOR v_jobname IN
    SELECT jobname FROM cron.job
    WHERE jobname ILIKE '%anthropic%' AND active = true
  LOOP
    PERFORM cron.unschedule(v_jobname);
    v_count := v_count + 1;
    RAISE NOTICE 'Unscheduled cron job: %', v_jobname;
  END LOOP;
  RAISE NOTICE 'Total Anthropic cronjobs disabled: %', v_count;
END $$;

INSERT INTO admin_actions (action, scope, payload, user_id)
VALUES ('anthropic_cronjobs_disabled', 'pipeline_governance',
  jsonb_build_object('rationale','User decision: stop using Anthropic across the platform',
                     'action','unscheduled all cron.job entries matching %anthropic%'),
  'b0dbd616-9b93-47c8-83c5-39290130a6ea');