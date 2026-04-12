
-- Fix: RPC update_exam_question_meta_if_draft fails with "column elite_level is of type elite_level but expression is of type text"
-- Root cause: unnest(p_elite_levels) returns text, but column expects elite_level enum
CREATE OR REPLACE FUNCTION public.update_exam_question_meta_if_draft(
  p_ids uuid[],
  p_elite_levels text[],
  p_multi_variables boolean[],
  p_transfer_variants boolean[],
  p_distractor_types text[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare updated_cnt int;
begin
  update exam_questions q
  set
    elite_level = v.elite_level::elite_level,
    multi_variable = v.multi_variable,
    transfer_variant = v.transfer_variant,
    distractor_types = v.distractor_types
  from (
    select
      unnest(p_ids) as id,
      unnest(p_elite_levels) as elite_level,
      unnest(p_multi_variables) as multi_variable,
      unnest(p_transfer_variants) as transfer_variant,
      unnest(p_distractor_types) as distractor_types
  ) v
  where q.id = v.id and q.status = 'draft';

  get diagnostics updated_cnt = row_count;
  return updated_cnt;
end
$$;
