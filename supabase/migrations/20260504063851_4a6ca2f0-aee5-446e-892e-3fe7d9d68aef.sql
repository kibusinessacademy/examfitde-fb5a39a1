
ALTER TABLE public.package_steps DISABLE TRIGGER USER;

UPDATE public.package_steps ps
SET meta = ps.meta || jsonb_build_object('ok',true)
  || jsonb_build_object('verdict', jsonb_build_object('status', ps.meta->>'status','score', ps.meta->>'score','badge', ps.meta->>'badge','source','backfill_2026_05_04','backfilled_at', now()))
WHERE ps.step_key='quality_council' AND ps.status='done'
  AND (ps.meta->'verdict'->>'status') IS NULL
  AND ps.meta->>'status' IN ('pass','fail')
  AND COALESCE((ps.meta->>'executed')::bool,false)=true;

UPDATE public.package_steps ps
SET meta = ps.meta || jsonb_build_object('ok',true)
  || jsonb_build_object('verdict', jsonb_build_object('status','bypass','reason', COALESCE(ps.meta->>'done_reason', ps.meta->>'reset_reason','admin_bypass'),'source','backfill_2026_05_04','backfilled_at', now()))
WHERE ps.step_key='quality_council' AND ps.status='done'
  AND (ps.meta->'verdict'->>'status') IS NULL
  AND (ps.meta ? 'emergency_bypass'
    OR ps.meta->>'done_reason' ILIKE 'admin_%' OR ps.meta->>'done_reason' ILIKE 'manual%'
    OR ps.meta->>'done_reason' ILIKE 'multi_heal%' OR ps.meta->>'done_reason' ILIKE 'p0_%'
    OR ps.meta->>'done_reason' ILIKE 'sustainable_heal%' OR ps.meta->>'done_reason' ILIKE 'cluster_%');

UPDATE public.package_steps ps
SET meta = ps.meta || jsonb_build_object('ok',true)
  || jsonb_build_object('verdict', jsonb_build_object('status','legacy_unknown','reason','pre_verdict_contract_legacy_done_step','source','backfill_2026_05_04','backfilled_at', now()))
WHERE ps.step_key='quality_council' AND ps.status='done'
  AND (ps.meta->'verdict'->>'status') IS NULL;

ALTER TABLE public.package_steps ENABLE TRIGGER USER;

INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
VALUES ('governance_verdict_backfill','system',NULL,'success','quality_council backfill drift wave 2026-05-04', jsonb_build_object('wave','drift_wave_2026_05_04'));
