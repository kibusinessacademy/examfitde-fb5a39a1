
-- Fix the RPC to get award_type from qualification_catalog instead of drafts
CREATE OR REPLACE FUNCTION public.sync_qualification_wave_candidates(p_min_readiness numeric DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced int := 0;
BEGIN
  INSERT INTO public.qualification_wave_candidates (
    qualification_catalog_id, draft_id, candidate_status,
    readiness_score, award_type, provider_family, promotion_priority
  )
  SELECT
    d.qualification_catalog_id,
    d.id,
    'ready',
    d.readiness_score,
    qc.award_type,
    qc.provider_family,
    d.readiness_score * 0.7 + COALESCE((qc.metadata->>'market_score')::numeric, 50) * 0.3
  FROM public.qualification_curriculum_drafts d
  JOIN public.qualification_catalog qc ON qc.id = d.qualification_catalog_id
  WHERE d.readiness_score >= p_min_readiness
    AND d.status IN ('ready', 'draft')
    AND NOT EXISTS (
      SELECT 1 FROM public.qualification_wave_candidates wc
      WHERE wc.qualification_catalog_id = d.qualification_catalog_id
    )
  ON CONFLICT (qualification_catalog_id) DO UPDATE SET
    readiness_score = EXCLUDED.readiness_score,
    promotion_priority = EXCLUDED.promotion_priority,
    updated_at = now();

  GET DIAGNOSTICS v_synced = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'synced', v_synced);
END;
$$;
