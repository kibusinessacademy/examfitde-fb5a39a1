
-- Advance the stuck generate_lesson_minichecks step for Verkäufer package
-- DB confirms 160/160 lessons have >= 3 minichecks, freshRemaining=0
UPDATE package_steps 
SET status = 'done', 
    finished_at = now(),
    meta = meta || '{"manually_completed": true, "reason": "DB confirms 160/160 lessons covered, freshRemaining=0"}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_lesson_minichecks'
  AND status = 'queued';
