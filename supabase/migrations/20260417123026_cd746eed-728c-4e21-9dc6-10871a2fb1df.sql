
UPDATE job_queue SET status='failed', completed_at=NOW(), last_error='USER_EMERGENCY_STOP 2026-04-17'
WHERE status IN ('queued','enqueued','running')
  AND package_id IN ('e43c6cc6-ef18-4c72-a552-07d03ff8e14f','55036b44-7427-438f-81f2-3707c804d41f','e72f7008-3007-4b9c-b0b4-2a73d8e865e5','f1356e6b-995b-4b63-aee4-3d513da1b3f6','e008fc3b-6773-4935-8301-c440470b204c','2aba85aa-a4a2-4aa3-ae65-06f401317d35','7472b96f-22ed-493f-9aca-74e70ebcaf8e','ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f','c9d82e46-b7b0-4752-a6b1-53534c7e1666');

UPDATE ai_generation_requests SET status='cancelled', completed_at=NOW(),
    error_summary = COALESCE(error_summary,'{}'::jsonb) || jsonb_build_object('emergency_stop','2026-04-17')
WHERE status IN ('queued','processing','pending','running')
  AND package_id IN ('e43c6cc6-ef18-4c72-a552-07d03ff8e14f','55036b44-7427-438f-81f2-3707c804d41f','e72f7008-3007-4b9c-b0b4-2a73d8e865e5','f1356e6b-995b-4b63-aee4-3d513da1b3f6','e008fc3b-6773-4935-8301-c440470b204c','2aba85aa-a4a2-4aa3-ae65-06f401317d35','7472b96f-22ed-493f-9aca-74e70ebcaf8e','ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f','c9d82e46-b7b0-4752-a6b1-53534c7e1666');

UPDATE anthropic_batch_requests SET status='cancelled', completed_at=NOW(), error_message='USER_EMERGENCY_STOP'
WHERE status IN ('queued','processing','submitted','pending')
  AND package_id IN ('e43c6cc6-ef18-4c72-a552-07d03ff8e14f','55036b44-7427-438f-81f2-3707c804d41f','e72f7008-3007-4b9c-b0b4-2a73d8e865e5','f1356e6b-995b-4b63-aee4-3d513da1b3f6','e008fc3b-6773-4935-8301-c440470b204c','2aba85aa-a4a2-4aa3-ae65-06f401317d35','7472b96f-22ed-493f-9aca-74e70ebcaf8e','ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f','c9d82e46-b7b0-4752-a6b1-53534c7e1666');

UPDATE package_steps SET status='blocked'::step_status, updated_at=NOW(),
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('paused_reason','user_emergency_stop','paused_at','2026-04-17T12:30:00Z','original_status','queued')
WHERE status = 'queued'::step_status
  AND package_id IN ('e43c6cc6-ef18-4c72-a552-07d03ff8e14f','55036b44-7427-438f-81f2-3707c804d41f','e72f7008-3007-4b9c-b0b4-2a73d8e865e5','f1356e6b-995b-4b63-aee4-3d513da1b3f6','e008fc3b-6773-4935-8301-c440470b204c','2aba85aa-a4a2-4aa3-ae65-06f401317d35','7472b96f-22ed-493f-9aca-74e70ebcaf8e','ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f','c9d82e46-b7b0-4752-a6b1-53534c7e1666');

DELETE FROM minicheck_questions WHERE lesson_id IN (
  SELECT l.id FROM lessons l JOIN modules m ON m.id = l.module_id 
  WHERE m.course_id IN ('b14bf4ca-7f34-4630-b648-3bdd93953d8a','a91e31c0-d61d-4b32-9497-03c678c8c8d8','525dc277-f371-4851-bf1b-63d78e81f77a','09bf84dc-f0b2-4f80-b095-7f50923be919','47872f87-e304-40bb-b909-4363fd77f308','dd01e236-6107-4552-8dad-ac9b1e34dd3e','5438997b-8a20-4e61-8628-7a5526195ad9','18192d33-70bb-4ef9-8c29-6fe49ee8f7cd','2f32fc7b-edd4-4b51-ba4d-19a1907fa295','fc3cad77-bd09-482f-8068-ed6c8af65656')
);
DELETE FROM lessons WHERE module_id IN (SELECT id FROM modules WHERE course_id IN ('b14bf4ca-7f34-4630-b648-3bdd93953d8a','a91e31c0-d61d-4b32-9497-03c678c8c8d8','525dc277-f371-4851-bf1b-63d78e81f77a','09bf84dc-f0b2-4f80-b095-7f50923be919','47872f87-e304-40bb-b909-4363fd77f308','dd01e236-6107-4552-8dad-ac9b1e34dd3e','5438997b-8a20-4e61-8628-7a5526195ad9','18192d33-70bb-4ef9-8c29-6fe49ee8f7cd','2f32fc7b-edd4-4b51-ba4d-19a1907fa295','fc3cad77-bd09-482f-8068-ed6c8af65656'));
DELETE FROM modules WHERE course_id IN ('b14bf4ca-7f34-4630-b648-3bdd93953d8a','a91e31c0-d61d-4b32-9497-03c678c8c8d8','525dc277-f371-4851-bf1b-63d78e81f77a','09bf84dc-f0b2-4f80-b095-7f50923be919','47872f87-e304-40bb-b909-4363fd77f308','dd01e236-6107-4552-8dad-ac9b1e34dd3e','5438997b-8a20-4e61-8628-7a5526195ad9','18192d33-70bb-4ef9-8c29-6fe49ee8f7cd','2f32fc7b-edd4-4b51-ba4d-19a1907fa295','fc3cad77-bd09-482f-8068-ed6c8af65656');

DELETE FROM handbook_sections WHERE chapter_id IN (SELECT id FROM handbook_chapters WHERE curriculum_id IN ('fce1158a-caa6-4873-80aa-16fd8f016688','f464f6d2-5697-4f00-9a98-4610826688e9','500cf9f9-e89b-4152-844d-612c6f365400','ffb96610-25b8-4652-aa6b-3bad77bfce62','3be4c9af-0fe1-4c42-9352-3f3d0b3a743d','3d8bd5bf-abc4-4564-ad9b-86d821250aa2','d95c085b-7a4d-49af-8ef3-046b1f9e53e9','e4ed48be-4672-485b-b8bf-3eab4f8b3c44','d5428612-e734-40d3-86fb-d69e7dbbbec0','cc1d59a8-0172-4a48-8688-4d43bdea375d'));
DELETE FROM handbook_chapters WHERE curriculum_id IN ('fce1158a-caa6-4873-80aa-16fd8f016688','f464f6d2-5697-4f00-9a98-4610826688e9','500cf9f9-e89b-4152-844d-612c6f365400','ffb96610-25b8-4652-aa6b-3bad77bfce62','3be4c9af-0fe1-4c42-9352-3f3d0b3a743d','3d8bd5bf-abc4-4564-ad9b-86d821250aa2','d95c085b-7a4d-49af-8ef3-046b1f9e53e9','e4ed48be-4672-485b-b8bf-3eab4f8b3c44','d5428612-e734-40d3-86fb-d69e7dbbbec0','cc1d59a8-0172-4a48-8688-4d43bdea375d');
DELETE FROM exam_blueprints WHERE curriculum_id IN ('fce1158a-caa6-4873-80aa-16fd8f016688','f464f6d2-5697-4f00-9a98-4610826688e9','500cf9f9-e89b-4152-844d-612c6f365400','ffb96610-25b8-4652-aa6b-3bad77bfce62','3be4c9af-0fe1-4c42-9352-3f3d0b3a743d','3d8bd5bf-abc4-4564-ad9b-86d821250aa2','d95c085b-7a4d-49af-8ef3-046b1f9e53e9','e4ed48be-4672-485b-b8bf-3eab4f8b3c44','d5428612-e734-40d3-86fb-d69e7dbbbec0','cc1d59a8-0172-4a48-8688-4d43bdea375d');

UPDATE course_packages SET status='blocked', updated_at=NOW(),
    blocked_reason='intentional_pause',
    blocked_at=NOW(),
    unblock_hint='USER_EMERGENCY_STOP 2026-04-17 — Reseed in progress'
WHERE id IN ('e43c6cc6-ef18-4c72-a552-07d03ff8e14f','55036b44-7427-438f-81f2-3707c804d41f','e72f7008-3007-4b9c-b0b4-2a73d8e865e5','f1356e6b-995b-4b63-aee4-3d513da1b3f6','e008fc3b-6773-4935-8301-c440470b204c','2aba85aa-a4a2-4aa3-ae65-06f401317d35','7472b96f-22ed-493f-9aca-74e70ebcaf8e','ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f','c9d82e46-b7b0-4752-a6b1-53534c7e1666');

INSERT INTO admin_actions (action, scope, payload, affected_ids) VALUES (
  'emergency_stop_zertifikat_packages_v1', 'bulk:10_packages',
  jsonb_build_object('reason','user requested urgent stop','timestamp','2026-04-17T12:30:00Z'),
  ARRAY['e43c6cc6-ef18-4c72-a552-07d03ff8e14f','55036b44-7427-438f-81f2-3707c804d41f','e72f7008-3007-4b9c-b0b4-2a73d8e865e5','f1356e6b-995b-4b63-aee4-3d513da1b3f6','e008fc3b-6773-4935-8301-c440470b204c','2aba85aa-a4a2-4aa3-ae65-06f401317d35','7472b96f-22ed-493f-9aca-74e70ebcaf8e','ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f','c9d82e46-b7b0-4752-a6b1-53534c7e1666']::uuid[]
);
