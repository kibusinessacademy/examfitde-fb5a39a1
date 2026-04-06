
-- AEVO: Merge duplicate learning fields — reassign ALL FK references
-- Mapping: old → new (by sort_order)
-- 34788f4e → c420024c (sort 0)
-- 83ae296f → 0617e854 (sort 1)
-- 9dc97e7a → 2ffa09a5 (sort 2)
-- 358a86ed → 7c56f4bd (sort 3)

DO $$
DECLARE
  mappings text[][] := ARRAY[
    ARRAY['34788f4e-6bf1-41ea-8d61-6f723a3749a9', 'c420024c-0f22-487c-aded-700fe46dd0b8'],
    ARRAY['83ae296f-0190-48c2-8a1d-7e6437165353', '0617e854-069b-45e9-a55a-d55e9f238730'],
    ARRAY['9dc97e7a-2e92-4340-b3de-f2a178566cc3', '2ffa09a5-7be5-40f1-8c5c-5cd3039b76cd'],
    ARRAY['358a86ed-5f2a-441f-a204-c73a58b752ae', '7c56f4bd-fe0b-4f87-9596-a8139706ae6b']
  ];
  tbl text;
  old_id uuid;
  new_id uuid;
BEGIN
  FOR i IN 1..4 LOOP
    old_id := mappings[i][1]::uuid;
    new_id := mappings[i][2]::uuid;
    
    FOREACH tbl IN ARRAY ARRAY[
      'competencies', 'modules', 'exam_questions', 'user_competency_stats',
      'question_blueprints', 'oral_exam_questions', 'handbook_sections',
      'oral_exam_blueprints', 'learning_field_songs', 'exam_part_mappings',
      'exam_question_variants'
    ] LOOP
      EXECUTE format(
        'UPDATE %I SET learning_field_id = $1 WHERE learning_field_id = $2',
        tbl
      ) USING new_id, old_id;
    END LOOP;
  END LOOP;
END $$;

-- Delete the now-empty duplicate LFs
DELETE FROM learning_fields WHERE id IN (
  '34788f4e-6bf1-41ea-8d61-6f723a3749a9',
  '83ae296f-0190-48c2-8a1d-7e6437165353',
  '9dc97e7a-2e92-4340-b3de-f2a178566cc3',
  '358a86ed-5f2a-441f-a204-c73a58b752ae'
);

-- Reset the 3 failed validate_exam_pool steps to queued
UPDATE package_steps 
SET status = 'queued', 
    attempts = 0,
    meta = jsonb_build_object(
      'guard_state', 'healthy',
      'stall_reason_code', null,
      'consecutive_no_progress', 0,
      'last_guard_action', 'admin_reset_after_ssot_fix'
    ),
    updated_at = now()
WHERE step_key = 'validate_exam_pool' 
  AND status = 'failed'
  AND package_id IN (
    '047bc325-5244-4f21-affd-5395bf62bcff',
    'b960658d-95e9-4824-a404-821d5e9b5142',
    '38f58d97-20a2-49b5-8ba4-737a7887d521'
  );
