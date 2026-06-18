
INSERT INTO public.storage_bucket_registry (bucket_id, content_class, is_public, tenant_model)
VALUES ('bonus-songs', 'media_upload', false, 'system')
ON CONFLICT (bucket_id) DO UPDATE
   SET content_class = EXCLUDED.content_class,
       is_public = EXCLUDED.is_public,
       tenant_model = EXCLUDED.tenant_model;

UPDATE public.storage_attack_policies SET enabled = true;
UPDATE public.storage_attack_classes
   SET enabled = true, kill_switch = false
 WHERE phase = '2.0';
