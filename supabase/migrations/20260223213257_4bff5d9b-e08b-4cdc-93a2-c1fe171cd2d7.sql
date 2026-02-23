-- Hard-enforce: pipeline_write_lesson_content is PLACEHOLDER-ONLY
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content(
  p_lesson_id uuid,
  p_content jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE((p_content->>'_placeholder')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNCIL_REQUIRED: pipeline_write_lesson_content accepts placeholder-only content. Use content_versions + publish_approved_version() for final content.';
  END IF;

  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE public.lessons
  SET content = p_content,
      status = 'placeholder',
      updated_at = now()
  WHERE id = p_lesson_id;
END;
$$;

-- Consolidate provider_job_affinity
DELETE FROM public.provider_job_affinity WHERE job_type IN (
  'council_propose_step', 'council_critique_step', 'council_revise_step',
  'council_vote_and_verdict', 'council_publish_step'
);

INSERT INTO public.provider_job_affinity (job_type, preferred_provider, weight, reason)
VALUES ('council_run_step', 'openai', 7.00, 'Consolidated council path')
ON CONFLICT (job_type, preferred_provider) DO UPDATE SET weight = 7.00;