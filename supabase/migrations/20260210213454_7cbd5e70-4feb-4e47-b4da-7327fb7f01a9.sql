
-- =============================================
-- QC Infrastructure: Quarantine, Exam Blocks, Weight Tags, QC Results
-- =============================================

-- 1. Add quarantine & quality columns to lessons
ALTER TABLE public.lessons 
  ADD COLUMN IF NOT EXISTS quarantine_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS exam_block JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS weight_tag TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS minicheck_parsed BOOLEAN DEFAULT FALSE;

-- 2. QC run results table (per course, per run)
CREATE TABLE IF NOT EXISTS public.qc_run_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL, -- 'full' | 'minicheck' | 'dedup' | 'sort' | 'exam_block' | 'weight'
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | failed
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  stats JSONB DEFAULT '{}',
  issues JSONB DEFAULT '[]',
  fixes_applied JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_run_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "QC results readable by authenticated users"
  ON public.qc_run_results FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "QC results insertable by service role"
  ON public.qc_run_results FOR INSERT
  TO authenticated WITH CHECK (true);

-- 3. Add difficulty + competency_id to minicheck_questions
ALTER TABLE public.minicheck_questions
  ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS competency_id UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 4. Index for fast quarantine queries
CREATE INDEX IF NOT EXISTS idx_lessons_quarantine ON public.lessons(quarantine_status) WHERE quarantine_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_minicheck_parsed ON public.lessons(minicheck_parsed) WHERE minicheck_parsed = false;
CREATE INDEX IF NOT EXISTS idx_qc_run_results_course ON public.qc_run_results(course_id, run_type);
