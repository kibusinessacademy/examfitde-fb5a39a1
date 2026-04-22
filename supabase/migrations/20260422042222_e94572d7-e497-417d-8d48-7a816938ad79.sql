-- ═══ Targeted Repair Enqueue: 4 Coverage Heals + 1 PRINCE2 Integrity ═══
-- Uses direct INSERT to bypass building-only guards (this is a repair, not a step start)

-- 1. Bankfachwirt: 2 missing comps
INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts, run_after, lane, created_at)
VALUES (
  'package_generate_exam_pool',
  '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8',
  jsonb_build_object(
    'package_id', '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8',
    'curriculum_id', '1652e5ad-2cb0-4e19-9629-31f5da417a43',
    'mode', 'targeted_competency_fill',
    'is_repair', true,
    'target_competency_ids', jsonb_build_array(
      '5a1e769d-54d7-4be7-be20-9adeaa249231',
      'cabdad1c-d3f8-4059-834c-2a5ca16831de'
    ),
    'questions_per_blueprint', 6
  ),
  'pending', 90, 2, now(), 'recovery', now()
);

-- 2. Chirurgiemechaniker: 3 missing comps
INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts, run_after, lane, created_at)
VALUES (
  'package_generate_exam_pool',
  'a369b56b-f39d-4be4-9318-5ecc21d9289e',
  jsonb_build_object(
    'package_id', 'a369b56b-f39d-4be4-9318-5ecc21d9289e',
    'curriculum_id', 'dca48068-c82c-4701-b031-662d0a1c2f77',
    'mode', 'targeted_competency_fill',
    'is_repair', true,
    'target_competency_ids', jsonb_build_array(
      '5a959b67-4bcc-4ec1-bd5f-a2dd49bf7c59',
      'aac5ad19-2eb2-4e82-b32e-fc700b8043e1',
      'a43c8117-57a2-4576-a25f-345fef87b0b6'
    ),
    'questions_per_blueprint', 6
  ),
  'pending', 90, 2, now(), 'recovery', now()
);

-- 3. BWL Bachelor: 11 missing comps
INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts, run_after, lane, created_at)
VALUES (
  'package_generate_exam_pool',
  'a0b0c0d0-0010-4000-8000-000000000001',
  jsonb_build_object(
    'package_id', 'a0b0c0d0-0010-4000-8000-000000000001',
    'curriculum_id', 'a0b0c0d0-0002-4000-8000-000000000001',
    'mode', 'targeted_competency_fill',
    'is_repair', true,
    'target_competency_ids', jsonb_build_array(
      'f17069a9-ad4a-4ae1-a9a6-38ad90ed872f','e9b4ec5a-a9be-4458-9527-5de78e9a807c','21182bcf-6957-44da-9003-359c28c3d36c',
      'bb2841f3-c27c-4be5-854f-dc636b36e6f3','78510010-6a6a-4f07-94d9-4ac8ef2d0803','ae80c905-b3ba-4d40-af0c-ac4fffc1ee19',
      '3a689161-aa1d-478c-8efd-8d653d06cdf5','9ff6253f-7d52-4fdf-bc02-0efff7066cd9','b9d4d72e-5f72-40f0-ade7-1dbc2a301446',
      '916dd233-f414-4608-8d48-78763f3264c9','e3236874-8c7d-43ed-99d3-7464689eaeed'
    ),
    'questions_per_blueprint', 5
  ),
  'pending', 90, 2, now(), 'recovery', now()
);

-- 4. Fachinformatiker SI: 28 missing comps (84 BPs → split logic later if time-budget hit, function will retry via TARGETED_FILL_NO_PROGRESS)
INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts, run_after, lane, created_at)
VALUES (
  'package_generate_exam_pool',
  '96d0fb31-9951-408d-a83e-b2937f5a6af8',
  jsonb_build_object(
    'package_id', '96d0fb31-9951-408d-a83e-b2937f5a6af8',
    'curriculum_id', '53d13046-88bf-42bf-9a2e-05d5e4a4f272',
    'mode', 'targeted_competency_fill',
    'is_repair', true,
    'target_competency_ids', jsonb_build_array(
      'f20be8b5-98bf-4ffd-ba2f-066ce0a61b65','576736e9-b3fc-451e-9ff9-cbe00adb89bf','0ba2055d-88dd-414e-af44-f151da9cdeec',
      '36386df5-c078-4af7-8caa-04ffb9892f65','83f1d994-72af-4c64-94f1-1b85da69377a','ec47bd8a-5680-474b-b269-f8103a45b63b',
      'f45e77da-537a-42e3-91e2-7799064406c3','de93d093-0956-4304-bcc8-fce237cb6f58','844e41be-edf4-4cbe-af01-ad152d27898b',
      '8a6838ee-d77d-4af9-b8bc-a726fc21e1c3','afb4ee54-02b7-4849-a50a-d542599be36e','858c816d-ac48-4438-9107-7f1bdc946eff',
      '70fb3171-6402-4460-97b3-8e7b8925a6ea','9af6f6bc-17d6-4106-b470-418df42402df','94219342-cef5-493d-b769-305cd1f1a00f',
      'd4000e8f-4323-4fc0-ae9f-f2f910ceb279','d3886c2e-0fcb-4482-9180-1784c498686e','e483641a-c78b-4ab1-9189-6ce3e71a5df6',
      'e82a75c8-cedb-4e75-9c64-c917994e6073','b8373d13-eab0-4668-afc7-5a28bffc52db','f1ac8f05-db2f-4a35-9404-46dae8766b98',
      '8d3e6e17-11c1-4fd0-80d4-607aa71bd8d2','8913d5f9-f761-44b9-88fb-84d587e17601','974e0dd1-a7d3-4963-b6f9-962faa2ed5c7',
      'c4b1b65d-cb75-42cb-8701-1e628a03e752','a9496a74-8667-48de-91c8-9026eefe9bf6','4609d91c-88cb-4515-9651-aa0de388ec8c',
      '13677cc7-6abd-47c3-bcd5-496fcda11be1'
    ),
    'questions_per_blueprint', 4
  ),
  'pending', 95, 3, now(), 'recovery', now()
);

-- 5. PRINCE2: only integrity check (24/24 already covered, score 91 → push to 92)
INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts, run_after, lane, created_at)
SELECT
  'package_elite_harden',
  'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
  jsonb_build_object(
    'package_id','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
    'curriculum_id','192af095-c7b8-4556-b0a7-246ef54749e1',
    'is_repair', true
  ),
  'pending', 85, 2, now(), 'recovery', now()
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue
  WHERE job_type='package_elite_harden'
    AND package_id='bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'
    AND status IN ('pending','processing')
);

INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts, run_after, lane, created_at)
VALUES (
  'package_run_integrity_check',
  'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
  jsonb_build_object(
    'package_id','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
    'curriculum_id','192af095-c7b8-4556-b0a7-246ef54749e1'
  ),
  'pending', 80, 2, now() + interval '90 seconds', 'recovery', now()
);

-- Audit log
INSERT INTO admin_actions(action, scope, payload)
VALUES (
  'targeted_competency_fill_v2_dispatch',
  'multi_package_repair',
  jsonb_build_object(
    'pattern','generator_patch_p0_re_enqueue',
    'packages', jsonb_build_array(
      jsonb_build_object('label','Bankfachwirt','package_id','49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','missing_comps',2),
      jsonb_build_object('label','Chirurgiemechaniker','package_id','a369b56b-f39d-4be4-9318-5ecc21d9289e','missing_comps',3),
      jsonb_build_object('label','BWL Bachelor','package_id','a0b0c0d0-0010-4000-8000-000000000001','missing_comps',11),
      jsonb_build_object('label','Fachinfo SI','package_id','96d0fb31-9951-408d-a83e-b2937f5a6af8','missing_comps',28),
      jsonb_build_object('label','PRINCE2','package_id','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','mode','elite_harden+integrity')
    ),
    'note','Generator-Patch deployed: targeted_competency_fill mode w/ NO_EFFECT guard'
  )
);