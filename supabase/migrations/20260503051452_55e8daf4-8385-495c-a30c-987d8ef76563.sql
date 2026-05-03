-- Glas: repair_exam_pool_quality ist Phantom (Vorgänger done) → skippen
WITH upd AS (
  UPDATE public.package_steps
  SET status='skipped', last_error='auto_skipped_phantom_repair_obsolete', updated_at=now()
  WHERE package_id='956f203f-fac8-4683-9bd5-db886ee695a7'
    AND step_key='repair_exam_pool_quality'
    AND status='pending_enqueue'
  RETURNING id
)
INSERT INTO public.auto_heal_log
  (action_type, target_type, target_id, trigger_source, result_status, metadata)
SELECT 'control_lane_step_heal_v1', 'package_step', id::text,
       'control_lane_forensic_fix_v1', 'done',
       jsonb_build_object('package_id','956f203f-fac8-4683-9bd5-db886ee695a7','step','repair_exam_pool_quality','transition','pending_enqueue→skipped','reason','phantom_predecessor_done')
FROM upd;

-- Elektroniker: auto_publish failed → queued
WITH upd2 AS (
  UPDATE public.package_steps
  SET status='queued', last_error=NULL, updated_at=now(), attempts=0
  WHERE package_id='335decc8-9f68-4784-b318-a68f620bf77e'
    AND step_key='auto_publish'
    AND status='failed'
  RETURNING id
)
INSERT INTO public.auto_heal_log
  (action_type, target_type, target_id, trigger_source, result_status, metadata)
SELECT 'control_lane_step_heal_v1', 'package_step', id::text,
       'control_lane_forensic_fix_v1', 'done',
       jsonb_build_object('package_id','335decc8-9f68-4784-b318-a68f620bf77e','step','auto_publish','transition','failed→queued')
FROM upd2;

-- Re-Nudge
DO $$
DECLARE pkg uuid; res jsonb;
BEGIN
  FOREACH pkg IN ARRAY ARRAY[
    '335decc8-9f68-4784-b318-a68f620bf77e'::uuid,
    '956f203f-fac8-4683-9bd5-db886ee695a7'::uuid
  ]
  LOOP
    BEGIN
      res := public.admin_nudge_atomic_trigger(pkg, false);
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, metadata)
      VALUES ('control_lane_step_heal_v1','package',pkg::text,'control_lane_forensic_fix_v1','done',
              jsonb_build_object('step','renudge','result',res));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, error_message)
      VALUES ('control_lane_step_heal_v1','package',pkg::text,'control_lane_forensic_fix_v1','failed',SQLERRM);
    END;
  END LOOP;
END $$;