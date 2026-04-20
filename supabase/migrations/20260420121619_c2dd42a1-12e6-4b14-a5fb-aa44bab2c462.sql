-- Pool-Vereinheitlichung: marketing → default (Lane-Mechanik übernimmt Routing)
UPDATE public.job_type_policies
SET worker_pool = 'default'
WHERE job_type = 'package_auto_generate_seo_suite';

-- Bestehende pending Jobs auf neuen Pool umstellen (Trigger fn_guard_sync_worker_pool macht das auch automatisch beim nächsten UPDATE)
UPDATE public.job_queue
SET worker_pool = 'default',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('pool_realigned_to_default', now()::text)
WHERE job_type = 'package_auto_generate_seo_suite'
  AND status = 'pending'
  AND worker_pool = 'marketing';