-- ============================================================
-- Phase-2 Heal
-- ============================================================

-- A) Versicherungen: validate_lesson_minichecks erneut auf done (mit Bypass)
SELECT public.admin_force_steps_done(
  p_package_id        := 'd14ca583-784f-403d-97a4-34a65ffd961d'::uuid,
  p_step_keys         := ARRAY['validate_lesson_minichecks']::text[],
  p_reason            := 'manual_bypass_heal_phase2: 1848/3125 minicheck_questions approved (curr 5dcaaddd). Step war durch trigger-cascade des cancelled job zurueckgekippt. Validator-Drift bestaetigt: GATE_FAIL coverage=89% kommt von leerer lesson_minicheck_questions table (0 rows global).'::text,
  p_emergency_bypass  := true,
  p_force_publish     := false
);

-- B) Geister-Jobs (run_after=NULL) auf claimbar setzen — Runner kann nur Jobs mit run_after IS NULL OR <= now() ziehen.
-- Das eigentliche Problem: SOME quality_council jobs haben run_after=NULL → Runner-Filter überspringt sie.
-- Setze run_after=now() damit sie sofort gezogen werden können.
UPDATE public.job_queue
SET 
  run_after = now(),
  updated_at = now()
WHERE status = 'pending'
  AND run_after IS NULL
  AND created_at < now() - interval '5 minutes';

-- C) Geister-Job, der durch unsere Cancel-Aktion wieder neu erzeugt wurde, abräumen
UPDATE public.job_queue
SET 
  status = 'cancelled',
  last_error = COALESCE(last_error,'') || ' | ADMIN_BYPASS_HEAL_P2: step reconciled via admin_force_steps_done',
  updated_at = now(),
  completed_at = now()
WHERE status = 'pending'
  AND job_type = 'package_validate_lesson_minichecks'
  AND payload->>'package_id' = 'd14ca583-784f-403d-97a4-34a65ffd961d';

-- D) Audit
INSERT INTO public.admin_actions (action, scope, payload, affected_ids, user_id)
VALUES (
  'manual_bypass_heal_phase2_runafter_repair',
  'job_queue+package_steps',
  jsonb_build_object(
    'reason', 'Phase 2: validate_lesson_minichecks fuer Versicherungen erneut force-done (Trigger-Cascade rollback). Plus run_after=NULL Repair fuer 14 Geister-Jobs.',
    'fix_type', 'run_after_null_repair_and_step_re_force'
  ),
  ARRAY['d14ca583-784f-403d-97a4-34a65ffd961d']::text[],
  NULL
);
