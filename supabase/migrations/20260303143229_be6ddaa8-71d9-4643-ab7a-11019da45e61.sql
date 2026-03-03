-- Canary view: detects qc_status=approved but status=draft inconsistency
CREATE OR REPLACE VIEW public.v_pipeline_canary_qc_promotion AS
SELECT
  count(*) AS qc_approved_but_draft,
  min(created_at) AS oldest,
  max(created_at) AS latest
FROM public.exam_questions
WHERE qc_status = 'approved'
  AND status = 'draft';