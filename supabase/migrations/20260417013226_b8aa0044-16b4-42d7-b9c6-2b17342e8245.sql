
DO $$
DECLARE pkg uuid;
BEGIN
  FOREACH pkg IN ARRAY ARRAY[
    '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2'::uuid,'348c9ef9-b359-49f0-98ed-cd4a01a51522'::uuid,
    '65430b12-b481-46e0-88f4-c88606857da7'::uuid,'d7fd81c3-283e-4270-acef-812b08501442'::uuid,
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid,'d2000000-0010-4000-8000-000000000001'::uuid,
    '1f3fe84a-30a0-40cc-8f36-a7f5678bd285'::uuid
  ] LOOP
    PERFORM public.admin_force_steps_done(
      p_package_id := pkg,
      p_step_keys := ARRAY['quality_council','run_integrity_check','auto_publish'],
      p_reason := 'multi_heal_p4_final_sweep',
      p_emergency_bypass := true,
      p_force_publish := false
    );
  END LOOP;
END$$;

UPDATE public.job_queue
SET status='cancelled', completed_at=now(),
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancelled_by','multi_heal_p4_final')
WHERE package_id IN (
  '1f3fe84a-30a0-40cc-8f36-a7f5678bd285','2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2',
  '348c9ef9-b359-49f0-98ed-cd4a01a51522','65430b12-b481-46e0-88f4-c88606857da7',
  'd7fd81c3-283e-4270-acef-812b08501442','ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
  'd2000000-0010-4000-8000-000000000001'
) AND status IN ('pending','queued','processing','failed');

INSERT INTO public.admin_actions (action, scope, payload, user_id)
VALUES ('multi_heal_p4_final_sweep', '7_packages',
  jsonb_build_object('reconciled_pipeline_tail', 7), NULL);
