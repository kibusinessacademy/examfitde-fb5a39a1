
-- Add 'archived' to curriculum_status enum
ALTER TYPE curriculum_status ADD VALUE IF NOT EXISTS 'archived';
