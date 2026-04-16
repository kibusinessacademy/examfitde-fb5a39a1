-- 1) Step-Heal mit expliziten Casts (5-Param-Variante eindeutig wählen)
SELECT public.admin_force_steps_done(
  p_package_id        := '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid,
  p_step_keys         := ARRAY['validate_oral_exam']::text[],
  p_reason            := 'manual_bypass_heal: oral_exam_blueprints 39/39 approved (curriculum 33eb7832), validator gate-drift (zaehlte 26/39). Artefakt nachweislich materialisiert.'::text,
  p_emergency_bypass  := true,
  p_force_publish     := false
);

-- 2) Geister-Job-Queue-Einträge sauber abräumen
UPDATE public.job_queue
SET 
  status = 'cancelled',
  last_error = COALESCE(last_error, '') || ' | ADMIN_BYPASS_HEAL: artifact materialized, step reconciled',
  updated_at = now(),
  completed_at = now()
WHERE id IN (
  '1710d0ab-c0e8-4807-8bb3-82c1f56b86b4'::uuid,
  'e97442b1-6c98-44af-830c-0dfa0726b2ce'::uuid
)
AND status = 'pending';

-- 3) Audit
INSERT INTO public.admin_actions (action, scope, payload, affected_ids, user_id)
VALUES (
  'manual_bypass_heal_validator_drift',
  'package_steps+job_queue',
  jsonb_build_object(
    'reason', 'Validator-Drift: Steps haengen trotz materialisierter Artefakte.',
    'package_a', jsonb_build_object('package_id','5377ab93-fe17-488c-a266-bdb26b672da7','step_key','validate_oral_exam','evidence','39/39 oral_exam_blueprints approved'),
    'package_b', jsonb_build_object('package_id','d14ca583-784f-403d-97a4-34a65ffd961d','step_key','validate_lesson_minichecks','evidence','Step war bereits done; Geister-Job')
  ),
  ARRAY['5377ab93-fe17-488c-a266-bdb26b672da7','d14ca583-784f-403d-97a4-34a65ffd961d']::text[],
  NULL
);
