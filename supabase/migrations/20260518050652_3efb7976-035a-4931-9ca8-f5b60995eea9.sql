DO $$
DECLARE
  v_run record;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '6ab8859a-6470-4fa3-8501-d533844594c6')::text, true);

  SELECT * INTO v_run FROM admin_seo_bridge_promotion_execute(
    p_link_type := 'blog_to_pillar',
    p_suggestion_ids := ARRAY[
      'd0adcf13-ed97-4bba-bfea-e6bfd1bb1f0a',
      '9bb4baec-d23d-4b5f-87fc-eea2b599f298',
      '62f97814-b91e-4781-8a18-9e46404974e8',
      'd9a5002d-e746-4848-8d7e-476c9909346a',
      '3981ad00-2f7e-458b-a69e-54608facc657',
      'b189f3ec-0b0f-4da4-bc14-7893ff84dbab',
      'f4910a74-a76a-4b18-a50f-68c12f620736',
      'd1df2033-8eaa-439c-b541-7e41c9a0cef5',
      '86f5a0d3-6ff0-43b5-af98-4124e04e7449'
    ]::uuid[],
    p_batch_label := 'e3e4_wave2_promote9_live_excl_watchlist_2026-05-18',
    p_dry_run := false
  );

  RAISE NOTICE 'WAVE2-LIVE run_id=% requested=% promoted=% skipped=%',
    v_run.run_id, v_run.requested, v_run.promoted, v_run.skipped;
END $$;