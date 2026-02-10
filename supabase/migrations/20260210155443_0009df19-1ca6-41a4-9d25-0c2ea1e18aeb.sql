-- Fix: lesson_qc_view is a SECURITY DEFINER view (missing security_invoker=true)
-- Recreate with security_invoker=true so RLS of the querying user is enforced

DROP VIEW IF EXISTS public.lesson_qc_view;

CREATE VIEW public.lesson_qc_view WITH (security_invoker=true) AS
SELECT
  l.id,
  l.module_id,
  l.competency_id,
  l.title,
  l.step,
  l.sort_order,
  l.status,
  l.qc_status,
  l.duration_minutes,
  l.created_at,
  COALESCE((l.content ->> 'html'::text), ''::text) AS qc_html,
  COALESCE(( SELECT array_agg(t.value) AS array_agg
         FROM jsonb_array_elements_text(COALESCE((l.content -> 'objectives'::text), '[]'::jsonb)) t(value)), ARRAY[]::text[]) AS qc_objectives,
  NULLIF((l.content ->> 'exam_block'::text), ''::text) AS qc_exam_block,
  NULLIF((l.content ->> 'weight_tag'::text), ''::text) AS qc_weight_tag,
  ( SELECT count(*) AS count
         FROM minicheck_questions mq
        WHERE (mq.lesson_id = l.id)) AS minicheck_count
FROM lessons l;