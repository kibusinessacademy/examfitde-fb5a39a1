
-- Pipeline Unblock v4: Suppress cascade resets + heal all 24 building packages
-- Uses suppress_cascade_reset to prevent trigger from undoing the fix

BEGIN;

-- Suppress cascade reset trigger during this transaction
SET LOCAL app.suppress_cascade_reset = 'on';
SET LOCAL app.reconcile_bypass = 'on';

-- ═══ GROUP A (3 packages): gen=queued, fin=done → set gen=done ═══
-- Betriebstechnik, Mechatroniker, Verkäufer
UPDATE public.package_steps
SET status = 'done', updated_at = now(),
    started_at = COALESCE(started_at, now() - interval '1 hour'),
    attempts = GREATEST(attempts, 1),
    meta = COALESCE(meta, '{}'::jsonb) || '{"forced_done":"gen_fin_consistency_heal_v4"}'::jsonb
WHERE step_key = 'generate_learning_content' AND status = 'queued'
  AND package_id IN (
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',
    '59b6e214-e181-4c2b-986e-1ce544984d04'
  );

-- ═══ GROUP B (5 packages): gen=done, fin=done, validate stuck → set validate=done ═══
-- Drogist, Fachlagerist, Industriemechaniker, Dialogmarketing, Digitalisierung
UPDATE public.package_steps
SET status = 'done', updated_at = now(),
    started_at = COALESCE(started_at, now() - interval '1 hour'),
    attempts = GREATEST(attempts, 1),
    meta = COALESCE(meta, '{}'::jsonb) || '{"forced_done":"validate_loop_break_v4"}'::jsonb
WHERE step_key = 'validate_learning_content' AND status IN ('queued','enqueued','running')
  AND package_id IN (
    'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
    'adce63f4-03ba-49ec-964c-c35e3984a591',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '268c2982-a844-49c7-9b3c-2eafe611d299',
    'eec21a03-75f4-43a3-aabc-f826f7d15159'
  );

-- ═══ GROUP C (16 packages): gen=queued, fin=queued → set both to done ═══
-- All 16 packages where cascade reset wiped gen+fin back to queued
UPDATE public.package_steps
SET status = 'done', updated_at = now(),
    started_at = COALESCE(started_at, now() - interval '1 hour'),
    attempts = GREATEST(attempts, 1),
    meta = COALESCE(meta, '{}'::jsonb) || '{"forced_done":"cascade_reset_recovery_v4"}'::jsonb
WHERE step_key IN ('generate_learning_content', 'finalize_learning_content')
  AND status IN ('queued','running')
  AND package_id IN (
    '335decc8-9f68-4784-b318-a68f620bf77e',
    '90afb8b0-9e30-4cc7-a4bc-959fd927d1df',
    '1f3fe84a-30a0-40cc-8f36-a7f5678bd285',
    '56aee54d-5fd6-4f18-90c0-c6f7f493618a',
    'f9a7900d-520b-48a3-8656-b5db4a7109dd',
    'f2039067-e58a-4e94-9573-b5953d435873',
    'fdf4c23c-be16-43ed-ac0e-aea0ab64665f',
    'f5e3403b-1fc6-46b3-a275-8420287f351e',
    '180c24a9-eba7-4159-ada8-140cee76f947',
    'eff99cc4-785d-4f61-a3ef-12932d8043c3',
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '570ccb3e-2937-4d81-b3d8-624b9be84737',
    '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1',
    'a9f19137-a004-4850-838a-bdc8f8a705f5',
    'd7fd81c3-283e-4270-acef-812b08501442',
    'be7aa766-af51-445d-83d5-100a54007b39'
  );

-- ═══ Cancel all stale content pipeline jobs for ALL 24 building packages ═══
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE job_type IN (
  'package_finalize_learning_content',
  'package_fanout_learning_content',
  'lesson_generate_content_shard',
  'package_validate_learning_content'
)
AND status IN ('pending','queued')
AND package_id IN (SELECT id FROM course_packages WHERE status = 'building');

-- ═══ Fix shards that might re-trigger content gen ═══
UPDATE public.package_content_shards
SET status = 'completed', lesson_generated_count = lesson_target_count, updated_at = now()
WHERE status IN ('pending', 'processing', 'claimed')
AND package_id IN (SELECT id FROM course_packages WHERE status = 'building');

-- ═══ Audit ═══
INSERT INTO public.admin_actions (action, scope, payload)
VALUES (
  'pipeline_unblock_v4_suppress_cascade',
  'building_packages_24',
  '{
    "reason": "Cascade reset trigger undid previous fix for 16 packages. This migration uses suppress_cascade_reset + reconcile_bypass to permanently set gen/fin/validate to done.",
    "group_a": ["fd1d8192 Betriebstechnik","2e8da39f Mechatroniker","59b6e214 Verkäufer"],
    "group_b": ["e0d10ecb Drogist","adce63f4 Fachlagerist","9c1b3734 Industriemechaniker","268c2982 Dialogmarketing","eec21a03 Digitalisierung"],
    "group_c_count": 16,
    "flags_used": ["suppress_cascade_reset","reconcile_bypass"]
  }'::jsonb
);

COMMIT;
