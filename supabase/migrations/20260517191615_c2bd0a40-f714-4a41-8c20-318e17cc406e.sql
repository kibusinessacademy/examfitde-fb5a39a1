INSERT INTO ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('contextual_materialization_detected', ARRAY['correlation_id','phase','detected_count'], 'seo_blog_publish'),
  ('contextual_materialization_applied',  ARRAY['correlation_id','phase','applied_count'],  'seo_blog_publish'),
  ('contextual_materialization_summary',  ARRAY['correlation_id','phase','detected','applied','skipped_dup_active','skipped_src_unpublished','skipped_tgt_unpublished'], 'seo_blog_publish')
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE
  v_corr uuid := gen_random_uuid();
  v_phase text := 'e3d_2a_contextual_materialization';
  v_detected int; v_skip_src int; v_skip_tgt int; v_skip_dup int; v_applied int;
BEGIN
  CREATE TEMP TABLE _e3d2a_candidates ON COMMIT DROP AS
  SELECT s.id, s.source_url, s.target_url,
         src_ba.status AS src_status, tgt_ba.status AS tgt_status
  FROM seo_internal_link_suggestions s
  LEFT JOIN blog_articles src_ba ON s.source_url = '/blog/' || src_ba.slug
  LEFT JOIN blog_articles tgt_ba ON s.target_url = '/blog/' || tgt_ba.slug
  WHERE s.link_type = 'contextual' AND s.status = 'suggested';

  SELECT COUNT(*) INTO v_detected FROM _e3d2a_candidates;
  SELECT COUNT(*) INTO v_skip_src FROM _e3d2a_candidates WHERE src_status IS DISTINCT FROM 'published';
  SELECT COUNT(*) INTO v_skip_tgt FROM _e3d2a_candidates WHERE src_status = 'published' AND tgt_status IS DISTINCT FROM 'published';

  WITH dups AS (
    SELECT c.id FROM _e3d2a_candidates c
    JOIN seo_internal_link_suggestions a
      ON a.source_url = c.source_url AND a.target_url = c.target_url
     AND a.link_type = 'contextual' AND a.status = 'active' AND a.id <> c.id
  )
  SELECT COUNT(*) INTO v_skip_dup FROM dups;

  PERFORM public.fn_emit_audit(
    _action_type := 'contextual_materialization_detected',
    _payload := jsonb_build_object('correlation_id', v_corr, 'phase', v_phase, 'detected_count', v_detected),
    _trigger_source := 'e3d_runner');

  WITH eligible AS (
    SELECT id FROM _e3d2a_candidates WHERE src_status = 'published' AND tgt_status = 'published'
  ),
  upd AS (
    UPDATE seo_internal_link_suggestions s
       SET status = 'active', updated_at = now()
      FROM eligible e WHERE s.id = e.id RETURNING s.id
  )
  SELECT COUNT(*) INTO v_applied FROM upd;

  PERFORM public.fn_emit_audit(
    _action_type := 'contextual_materialization_applied',
    _payload := jsonb_build_object('correlation_id', v_corr, 'phase', v_phase, 'applied_count', v_applied),
    _trigger_source := 'e3d_runner');

  PERFORM public.fn_emit_audit(
    _action_type := 'contextual_materialization_summary',
    _payload := jsonb_build_object('correlation_id', v_corr, 'phase', v_phase,
      'detected', v_detected, 'applied', v_applied,
      'skipped_dup_active', v_skip_dup,
      'skipped_src_unpublished', v_skip_src,
      'skipped_tgt_unpublished', v_skip_tgt),
    _trigger_source := 'e3d_runner');

  RAISE NOTICE 'E3d.2a: detected=% applied=% skip_dup=% skip_src=% skip_tgt=%',
    v_detected, v_applied, v_skip_dup, v_skip_src, v_skip_tgt;
END $$;