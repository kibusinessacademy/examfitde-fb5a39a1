
UPDATE public.exam_questions eq
SET certification_id = cur.certification_id
FROM public.curricula cur
WHERE eq.curriculum_id = cur.id
  AND eq.certification_id IS NULL
  AND cur.certification_id IS NOT NULL;
