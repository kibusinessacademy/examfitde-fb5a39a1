
DROP FUNCTION IF EXISTS public.upsert_qualification_candidate(text,text,text,text,text,jsonb);

CREATE OR REPLACE FUNCTION public.upsert_qualification_candidate(
  p_title_raw text,
  p_source_url text,
  p_provider_family text,
  p_source_type text DEFAULT 'html',
  p_award_type_hint text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.qualification_candidates (
    title_raw, source_url, provider_family, source_type, status, metadata
  )
  VALUES (
    p_title_raw, p_source_url, p_provider_family,
    coalesce(p_source_type, 'html'), 'discovered',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('award_type_hint', p_award_type_hint)
  )
  ON CONFLICT (source_url) DO UPDATE
    SET updated_at = now(),
        metadata = qualification_candidates.metadata || excluded.metadata
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
