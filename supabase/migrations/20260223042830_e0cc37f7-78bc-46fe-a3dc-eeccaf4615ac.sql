-- Add 'evaluate' to cognitive_level enum
ALTER TYPE cognitive_level ADD VALUE IF NOT EXISTS 'evaluate';

-- Add missing decision_structure_type values for rotation
ALTER TYPE decision_structure_type ADD VALUE IF NOT EXISTS 'tradeoff_evaluation';
ALTER TYPE decision_structure_type ADD VALUE IF NOT EXISTS 'error_detection';
