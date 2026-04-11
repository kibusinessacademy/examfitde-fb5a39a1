
-- Step 1: Reject legacy step_4_repetition entries that conflict with existing step_6_repetition
UPDATE content_versions cv_legacy
SET status = 'rejected', updated_at = now()
WHERE cv_legacy.step_key = 'step_4_repetition'
AND EXISTS (
  SELECT 1 FROM content_versions cv_canon
  WHERE cv_canon.lesson_id = cv_legacy.lesson_id
    AND cv_canon.step_key = 'step_6_repetition'
    AND cv_canon.entity_type = cv_legacy.entity_type
    AND cv_canon.council_round = cv_legacy.council_round
);

-- Step 2: Reject legacy step_5_minicheck entries that conflict
UPDATE content_versions cv_legacy
SET status = 'rejected', updated_at = now()
WHERE cv_legacy.step_key = 'step_5_minicheck'
AND EXISTS (
  SELECT 1 FROM content_versions cv_canon
  WHERE cv_canon.lesson_id = cv_legacy.lesson_id
    AND cv_canon.step_key = 'step_7_minicheck'
    AND cv_canon.entity_type = cv_legacy.entity_type
    AND cv_canon.council_round = cv_legacy.council_round
);

-- Step 3: Rename non-conflicting legacy keys
UPDATE content_versions SET step_key = 'step_6_repetition' WHERE step_key = 'step_4_repetition' AND status != 'rejected';
UPDATE content_versions SET step_key = 'step_7_minicheck' WHERE step_key = 'step_5_minicheck' AND status != 'rejected';
