
-- Add 'very_hard' to the question_difficulty enum
ALTER TYPE question_difficulty ADD VALUE IF NOT EXISTS 'very_hard' AFTER 'hard';
