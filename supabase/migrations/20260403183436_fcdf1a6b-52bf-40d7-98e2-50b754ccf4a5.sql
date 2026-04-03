
ALTER TYPE exam_context_type ADD VALUE IF NOT EXISTS 'calculation_analysis';
ALTER TYPE exam_context_type ADD VALUE IF NOT EXISTS 'case_study';
ALTER TYPE exam_context_type ADD VALUE IF NOT EXISTS 'model_comparison';
ALTER TYPE exam_context_type ADD VALUE IF NOT EXISTS 'strategic_decision';

ALTER TYPE didactic_intent ADD VALUE IF NOT EXISTS 'diagnose';
ALTER TYPE didactic_intent ADD VALUE IF NOT EXISTS 'elaborate';
