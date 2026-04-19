-- WAVE 6 FINAL

INSERT INTO public.ops_pipeline_config (key, value) VALUES ('wip_total_cap', '35')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO public.ops_pipeline_config (key, value) VALUES ('wip_bonus_slots', '10')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

UPDATE public.course_packages SET is_repair = true
WHERE id IN (
  '0d0dcc1d-ae63-4a48-975e-04e53241cee1','961103c5-74be-4357-8573-c73862cb09b2',
  'b77d271d-7815-4a5d-9643-7de31df83953','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
  '55036b44-7427-438f-81f2-3707c804d41f','f1356e6b-995b-4b63-aee4-3d513da1b3f6',
  'e43c6cc6-ef18-4c72-a552-07d03ff8e14f','c9d82e46-b7b0-4752-a6b1-53534c7e1666',
  '2aba85aa-a4a2-4aa3-ae65-06f401317d35','e72f7008-3007-4b9c-b0b4-2a73d8e865e5',
  '4d4e1f9f-cce9-48e7-8878-fd18eb3aedb7','ec0183bd-1b37-4da1-81ce-6924e07a7397',
  '0d351bb2-fea3-44a3-88ec-df14eefb269f','7472b96f-22ed-493f-9aca-74e70ebcaf8e',
  'e008fc3b-6773-4935-8301-c440470b204c'
);

-- AKTION 1: Awaiting-Source-Data
UPDATE public.course_packages
SET status = 'building', blocked_reason = NULL, updated_at = now()
WHERE id IN (
  '0d0dcc1d-ae63-4a48-975e-04e53241cee1','961103c5-74be-4357-8573-c73862cb09b2',
  'b77d271d-7815-4a5d-9643-7de31df83953','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'
);

UPDATE public.package_steps
SET status = 'queued',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'allow_regression', true, 'allow_regression_by', 'admin_manual', 'wave', 6),
    updated_at = now()
WHERE step_key = 'generate_learning_content'
  AND package_id IN (
    '0d0dcc1d-ae63-4a48-975e-04e53241cee1','961103c5-74be-4357-8573-c73862cb09b2',
    'b77d271d-7815-4a5d-9643-7de31df83953','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'
  );

INSERT INTO public.job_queue (job_type, package_id, status, lane, priority, payload, created_at, updated_at)
SELECT 'package_generate_learning_content', cp.id, 'pending', 'build', 2,
       jsonb_build_object(
         'package_id', cp.id::text, 'curriculum_id', cp.curriculum_id::text,
         'is_repair', true, 'priority_seed', true,
         'source', 'manual_priority_seed_awaiting_source_data', 'wave', 6
       ), now(), now()
FROM public.course_packages cp
WHERE cp.id IN (
  '0d0dcc1d-ae63-4a48-975e-04e53241cee1','961103c5-74be-4357-8573-c73862cb09b2',
  'b77d271d-7815-4a5d-9643-7de31df83953','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'
)
AND NOT EXISTS (
  SELECT 1 FROM public.job_queue jq
  WHERE jq.package_id = cp.id
    AND jq.job_type = 'package_generate_learning_content'
    AND jq.status IN ('pending','processing','running')
);

-- AKTION 2: Familienrecht-Cluster
UPDATE public.course_packages
SET status = 'building', blocked_reason = NULL, updated_at = now()
WHERE id IN (
  '55036b44-7427-438f-81f2-3707c804d41f','f1356e6b-995b-4b63-aee4-3d513da1b3f6',
  'e43c6cc6-ef18-4c72-a552-07d03ff8e14f','c9d82e46-b7b0-4752-a6b1-53534c7e1666',
  '2aba85aa-a4a2-4aa3-ae65-06f401317d35','e72f7008-3007-4b9c-b0b4-2a73d8e865e5',
  '4d4e1f9f-cce9-48e7-8878-fd18eb3aedb7','ec0183bd-1b37-4da1-81ce-6924e07a7397',
  '0d351bb2-fea3-44a3-88ec-df14eefb269f','7472b96f-22ed-493f-9aca-74e70ebcaf8e',
  'e008fc3b-6773-4935-8301-c440470b204c'
);

UPDATE public.package_steps
SET status = 'queued',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'allow_regression', true, 'allow_regression_by', 'admin_manual', 'wave', 6),
    updated_at = now()
WHERE step_key = 'scaffold_learning_course'
  AND package_id IN (
    '55036b44-7427-438f-81f2-3707c804d41f','f1356e6b-995b-4b63-aee4-3d513da1b3f6',
    'e43c6cc6-ef18-4c72-a552-07d03ff8e14f','c9d82e46-b7b0-4752-a6b1-53534c7e1666',
    '2aba85aa-a4a2-4aa3-ae65-06f401317d35','e72f7008-3007-4b9c-b0b4-2a73d8e865e5',
    'ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f',
    '7472b96f-22ed-493f-9aca-74e70ebcaf8e','e008fc3b-6773-4935-8301-c440470b204c'
  );

INSERT INTO public.job_queue (job_type, package_id, status, lane, priority, payload, created_at, updated_at)
SELECT 'package_scaffold_learning_course', cp.id, 'pending', 'recovery', 3,
       jsonb_build_object(
         'package_id', cp.id::text, 'curriculum_id', cp.curriculum_id::text,
         'is_repair', true, 'source', 'manual_familienrecht_cluster_repair',
         'wave', 6, 'cluster', 'familienrecht'
       ), now(), now()
FROM public.course_packages cp
WHERE cp.id IN (
  '55036b44-7427-438f-81f2-3707c804d41f','f1356e6b-995b-4b63-aee4-3d513da1b3f6',
  'e43c6cc6-ef18-4c72-a552-07d03ff8e14f','c9d82e46-b7b0-4752-a6b1-53534c7e1666',
  '2aba85aa-a4a2-4aa3-ae65-06f401317d35','e72f7008-3007-4b9c-b0b4-2a73d8e865e5',
  'ec0183bd-1b37-4da1-81ce-6924e07a7397','0d351bb2-fea3-44a3-88ec-df14eefb269f',
  '7472b96f-22ed-493f-9aca-74e70ebcaf8e','e008fc3b-6773-4935-8301-c440470b204c'
)
AND NOT EXISTS (
  SELECT 1 FROM public.job_queue jq
  WHERE jq.package_id = cp.id
    AND jq.job_type = 'package_scaffold_learning_course'
    AND jq.status IN ('pending','processing','running')
);

INSERT INTO public.admin_actions (action, scope, payload, affected_ids, created_at)
VALUES (
  'wave6_priority_seed_and_familienrecht_repair',
  'pipeline_repair',
  jsonb_build_object(
    'awaiting_source_data', ARRAY['0d0dcc1d','961103c5','b77d271d','bae6fc7b'],
    'familienrecht', ARRAY['55036b44','f1356e6b','e43c6cc6','c9d82e46','2aba85aa','e72f7008','4d4e1f9f','ec0183bd','0d351bb2','7472b96f','e008fc3b'],
    'wip_cap_raised_to', 35, 'wip_bonus', 10, 'wave', 6,
    'note', '4d4e1f9f only unblocked - existing job kept'
  ),
  ARRAY[
    '0d0dcc1d-ae63-4a48-975e-04e53241cee1','961103c5-74be-4357-8573-c73862cb09b2',
    'b77d271d-7815-4a5d-9643-7de31df83953','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
    '55036b44-7427-438f-81f2-3707c804d41f','f1356e6b-995b-4b63-aee4-3d513da1b3f6',
    'e43c6cc6-ef18-4c72-a552-07d03ff8e14f','c9d82e46-b7b0-4752-a6b1-53534c7e1666',
    '2aba85aa-a4a2-4aa3-ae65-06f401317d35','e72f7008-3007-4b9c-b0b4-2a73d8e865e5',
    '4d4e1f9f-cce9-48e7-8878-fd18eb3aedb7','ec0183bd-1b37-4da1-81ce-6924e07a7397',
    '0d351bb2-fea3-44a3-88ec-df14eefb269f','7472b96f-22ed-493f-9aca-74e70ebcaf8e',
    'e008fc3b-6773-4935-8301-c440470b204c'
  ]::text[],
  now()
);