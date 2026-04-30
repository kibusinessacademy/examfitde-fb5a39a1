-- ============================================================
-- SEO Auto-Match Batch-Apply (Strong Matches ≥70%)
-- Übernimmt automatisch den Top-1-Vorschlag aus
-- admin_seo_suggest_product_matches, wenn dessen Score den
-- Schwellwert (default 0.70) erreicht. Audit pro Übernahme.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_seo_batch_apply_strong_matches(
  p_min_score numeric DEFAULT 0.70,
  p_limit integer DEFAULT 25,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seo record;
  v_top record;
  v_applied jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_count integer := 0;
BEGIN
  -- Admin-Gate
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_min_score < 0.40 THEN
    RAISE EXCEPTION 'min_score_too_low: must be >= 0.40 (manual review threshold)';
  END IF;

  -- Iteriere unmatched certification_seo_pages (published, kein Override)
  FOR v_seo IN
    SELECT csp.id, csp.slug, csp.title
    FROM public.certification_seo_pages csp
    LEFT JOIN public.v_seo_dead_end_drift d
      ON d.seo_id = csp.id
     AND d.source_table = 'certification_seo_pages'
    WHERE d.drift_reason = 'unmatched_no_product'
      AND (csp.product_slug_override IS NULL OR length(trim(csp.product_slug_override)) = 0)
    LIMIT p_limit
  LOOP
    -- Top-1 Vorschlag holen
    SELECT * INTO v_top
    FROM public.admin_seo_suggest_product_matches(v_seo.id, 1)
    LIMIT 1;

    IF v_top.canonical_slug IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'seo_id', v_seo.id, 'slug', v_seo.slug, 'reason', 'no_suggestion'
      );
      CONTINUE;
    END IF;

    IF v_top.match_score < p_min_score THEN
      v_skipped := v_skipped || jsonb_build_object(
        'seo_id', v_seo.id, 'slug', v_seo.slug,
        'reason', 'below_threshold',
        'best_score', v_top.match_score,
        'best_candidate', v_top.canonical_slug
      );
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      UPDATE public.certification_seo_pages
         SET product_slug_override = v_top.canonical_slug,
             updated_at = now()
       WHERE id = v_seo.id;

      INSERT INTO public.auto_heal_log (action_type, target_id, payload)
      VALUES (
        'seo_batch_strong_match_applied_v1',
        v_seo.id,
        jsonb_build_object(
          'seo_slug', v_seo.slug,
          'override_slug', v_top.canonical_slug,
          'package_id', v_top.package_id,
          'match_score', v_top.match_score,
          'match_reason', v_top.match_reason,
          'min_score_threshold', p_min_score,
          'caller', auth.uid()
        )
      );
    END IF;

    v_applied := v_applied || jsonb_build_object(
      'seo_id', v_seo.id,
      'slug', v_seo.slug,
      'override_slug', v_top.canonical_slug,
      'package_id', v_top.package_id,
      'match_score', v_top.match_score,
      'match_reason', v_top.match_reason
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'min_score', p_min_score,
    'applied_count', v_count,
    'skipped_count', jsonb_array_length(v_skipped),
    'applied', v_applied,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_seo_batch_apply_strong_matches(numeric, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_seo_batch_apply_strong_matches IS
'Batch-übernimmt Top-1 Auto-Match-Vorschläge mit Score >= p_min_score (default 0.70). Audit pro Apply. Dry-Run möglich.';