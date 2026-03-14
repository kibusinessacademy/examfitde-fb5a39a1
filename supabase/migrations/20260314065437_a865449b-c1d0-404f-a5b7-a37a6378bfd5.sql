
-- =====================================================
-- FORENSIC HEAL: Industriemechaniker/-in (9c1b3734)
-- Course: 235f622e-6046-487e-8465-e1ab7daae252
-- Package: 9c1b3734-bb25-4986-baef-5bb1c20a212c
-- =====================================================
-- 
-- DIAGNOSIS:
-- 1. 240/240 lessons have minicheck_parsed = false
-- 2. 192 non-minicheck lessons (einstieg/verstehen/anwenden/wiederholen) 
--    don't need minichecks but block the 80% threshold
-- 3. 46/48 mini_check lessons already have valid questions (>=3) 
--    but were never marked parsed
-- 4. Only 2 mini_check lessons truly lack content
--
-- FIX: Set minicheck_parsed = true where appropriate
-- =====================================================

-- Step 1: Mark all non-minicheck lessons as parsed (they are exempt)
UPDATE lessons
SET minicheck_parsed = true
WHERE module_id IN (
  SELECT m.id FROM modules m 
  WHERE m.course_id = '235f622e-6046-487e-8465-e1ab7daae252'
)
AND step != 'mini_check'
AND minicheck_parsed = false;

-- Step 2: Mark mini_check lessons with valid questions as parsed
UPDATE lessons
SET minicheck_parsed = true
WHERE module_id IN (
  SELECT m.id FROM modules m 
  WHERE m.course_id = '235f622e-6046-487e-8465-e1ab7daae252'
)
AND step = 'mini_check'
AND minicheck_parsed = false
AND content IS NOT NULL
AND jsonb_typeof(content::jsonb->'questions') = 'array'
AND jsonb_array_length(content::jsonb->'questions') >= 3;
