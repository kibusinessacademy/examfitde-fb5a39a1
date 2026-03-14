
-- =====================================================
-- SYSTEMWIDE FIX: minicheck_parsed = false bug
-- All non-minicheck lessons (einstieg/verstehen/anwenden/wiederholen)
-- should always be minicheck_parsed = true (they are exempt).
-- All mini_check lessons with valid questions (>=3) should be true.
-- =====================================================

-- Step 1: Fix ALL non-minicheck lessons systemwide
UPDATE lessons
SET minicheck_parsed = true
WHERE step != 'mini_check'
AND minicheck_parsed = false;

-- Step 2: Fix ALL mini_check lessons with valid questions systemwide
UPDATE lessons
SET minicheck_parsed = true
WHERE step = 'mini_check'
AND minicheck_parsed = false
AND content IS NOT NULL
AND jsonb_typeof(content::jsonb->'questions') = 'array'
AND jsonb_array_length(content::jsonb->'questions') >= 3;
