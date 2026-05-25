
-- Register/upgrade audit contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('job_queue_insert_suppressed_continuation_cap',
   ARRAY['reason','job_type','package_id','origin','recent_count','cap','window_hours'],
   'fn_guard_continuation_enqueue_cap'),
  ('job_queue_insert_suppressed_phantom_repair',
   ARRAY['reason','job_type','package_id','step_key','step_status','enqueue_source','origin'],
   'fn_guard_phantom_repair_enqueue'),
  ('job_queue_insert_suppressed_pool_fill_cooldown',
   ARRAY['reason','job_type','package_id','curriculum_id','recent_skips','window_minutes','cooldown_until'],
   'fn_guard_pool_fill_producer_cooldown')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module = EXCLUDED.owner_module;

UPDATE public.ops_audit_contract
SET required_keys = ARRAY['reason','scope','job_type','step_key','package_id','curriculum_id','blueprints','variants','coverage'],
    owner_module = 'fn_guard_redundant_seeding'
WHERE action_type = 'job_queue_insert_suppressed_redundant_seeding';

-- Guard 1: continuation_cap
CREATE OR REPLACE FUNCTION public.fn_guard_continuation_enqueue_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_origin text;
  v_recent int;
  v_cap int := 6;
  v_window interval := '1 hour';
BEGIN
  IF current_setting('session_replication_role', true) = 'replica' THEN RETURN NEW; END IF;
  IF NEW.payload IS NULL THEN RETURN NEW; END IF;

  v_origin := COALESCE(NEW.payload->>'_origin', NEW.payload->>'enqueue_source', NEW.payload->>'mode');
  IF v_origin IS NULL OR v_origin NOT ILIKE ANY (ARRAY[
    '%continuation%','%targeted_fill%','%blueprint_recovery%',
    '%competency_fill%','%pending_enqueue_per_row%','%auto_continuation%'
  ]) THEN RETURN NEW; END IF;
  IF NEW.package_id IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_recent
  FROM public.job_queue jq
  WHERE jq.package_id = NEW.package_id
    AND jq.job_type   = NEW.job_type
    AND jq.created_at > now() - v_window
    AND COALESCE(jq.payload->>'_origin', jq.payload->>'enqueue_source', jq.payload->>'mode') ILIKE ANY (ARRAY[
      '%continuation%','%targeted_fill%','%blueprint_recovery%',
      '%competency_fill%','%pending_enqueue_per_row%','%auto_continuation%'
    ]);

  IF v_recent >= v_cap THEN
    BEGIN
      PERFORM public.fn_emit_audit(
        'job_queue_insert_suppressed_continuation_cap',
        'package',
        NEW.package_id::text,
        'blocked',
        jsonb_build_object(
          'reason', 'CONTINUATION_LOOP_CAP',
          'job_type', NEW.job_type,
          'package_id', NEW.package_id,
          'origin', v_origin,
          'recent_count', v_recent,
          'cap', v_cap,
          'window_hours', 1,
          'ssot', 'raise_exception',
          'mirror_of', 'fn_guard_continuation_enqueue_cap'
        ),
        'fn_guard_continuation_enqueue_cap',
        format('cap=%s window=1h job_type=%s origin=%s', v_cap, NEW.job_type, v_origin)
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RAISE EXCEPTION
      'CONTINUATION_LOOP_CAP: % continuation enqueues for package=% job_type=% origin=% within 1h (cap=%). Investigate root cause before retrying.',
      v_recent, NEW.package_id, NEW.job_type, v_origin, v_cap
      USING HINT='Use admin_continuation_cap_override(true) for emergency bypass or increase cap deliberately.';
  END IF;
  RETURN NEW;
END;
$function$;

-- Guard 2: phantom_repair
CREATE OR REPLACE FUNCTION public.fn_guard_phantom_repair_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step_status text;
  v_step_key text := 'generate_exam_pool';
  v_blocked_reason text;
  v_enqueue_source text;
  v_origin text;
BEGIN
  IF NEW.job_type <> 'package_repair_exam_pool_quality' THEN RETURN NEW; END IF;
  IF NEW.package_id IS NULL THEN RETURN NEW; END IF;

  v_enqueue_source := NEW.payload->>'enqueue_source';
  v_origin := NEW.payload->>'_origin';

  IF v_enqueue_source = 'content_gap_topup' THEN
    SELECT blocked_reason INTO v_blocked_reason
    FROM public.course_packages WHERE id = NEW.package_id;
    IF v_blocked_reason = 'auto_heal_zombie' THEN RETURN NEW; END IF;
  END IF;

  IF v_enqueue_source = 'bronze_quality_lift'
     OR v_origin = 'bronze_quality_lift'
     OR v_origin = 'bronze_targeted_repair' THEN
    BEGIN
      PERFORM public.fn_emit_audit(
        'phantom_repair_bronze_lift_bypass',
        'package',
        NEW.package_id::text,
        'success',
        jsonb_build_object('package_id', NEW.package_id, 'enqueue_source', v_enqueue_source, 'origin', v_origin),
        'fn_guard_phantom_repair_enqueue',
        'Bronze quality-lift bypass granted for repair_exam_pool_quality'
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN NEW;
  END IF;

  SELECT status INTO v_step_status
  FROM public.package_steps
  WHERE package_id = NEW.package_id AND step_key = v_step_key;

  IF v_step_status IN ('done', 'skipped') THEN
    BEGIN
      PERFORM public.fn_emit_audit(
        'job_queue_insert_suppressed_phantom_repair',
        'package',
        NEW.package_id::text,
        'blocked',
        jsonb_build_object(
          'reason', 'PHANTOM_REPAIR_BLOCKED',
          'job_type', NEW.job_type,
          'package_id', NEW.package_id,
          'step_key', v_step_key,
          'step_status', v_step_status,
          'enqueue_source', v_enqueue_source,
          'origin', v_origin,
          'ssot', 'raise_exception',
          'mirror_of', 'fn_guard_phantom_repair_enqueue'
        ),
        'fn_guard_phantom_repair_enqueue',
        format('step=%s status=%s', v_step_key, v_step_status)
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RAISE EXCEPTION 'PHANTOM_REPAIR_BLOCKED: package_repair_exam_pool_quality skipped — step % already %', v_step_key, v_step_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Guard 3: pool_fill_producer_cooldown
CREATE OR REPLACE FUNCTION public.fn_guard_pool_fill_producer_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cur uuid;
  v_recent int;
  v_until timestamptz := now() + interval '10 minutes';
BEGIN
  IF NEW.job_type <> 'pool_fill_bloom_gaps' THEN RETURN NEW; END IF;
  IF COALESCE((NEW.payload->>'producer_cooldown_override')::boolean, false) THEN RETURN NEW; END IF;
  v_cur := NULLIF(NEW.payload->>'curriculum_id','')::uuid;
  IF v_cur IS NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_recent
  FROM public.auto_heal_log
  WHERE action_type = 'pool_fill_bloom_gaps_recent_fill_skipped'
    AND created_at > now() - interval '10 minutes'
    AND (metadata->>'curriculum_id') = v_cur::text;

  IF v_recent > 0 THEN
    BEGIN
      PERFORM public.fn_emit_audit(
        'job_queue_insert_suppressed_pool_fill_cooldown',
        'job_queue',
        NEW.package_id::text,
        'skipped',
        jsonb_build_object(
          'reason', 'PRODUCER_COOLDOWN_ACTIVE',
          'job_type', NEW.job_type,
          'package_id', NEW.package_id,
          'curriculum_id', v_cur,
          'recent_skips', v_recent,
          'window_minutes', 10,
          'cooldown_until', v_until,
          'enqueue_source', NEW.payload->>'enqueue_source',
          'ssot', 'return_null',
          'mirror_of', 'fn_guard_pool_fill_producer_cooldown'
        ),
        'fn_guard_pool_fill_producer_cooldown',
        'producer_cooldown_active_recent_fill_skipped_within_10min'
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Guard 4: redundant_seeding (upgrade mirror to fn_emit_audit)
CREATE OR REPLACE FUNCTION public.fn_guard_redundant_seeding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pkg_id uuid;
  _curriculum_id uuid;
  _step_key text;
  _bp_count int := 0;
  _variant_count int := 0;
  _required_min int := 10;
  _coverage numeric := 0;
  _is_truth boolean := false;
  _reason text;
  _is_targeted_fill boolean := false;
  _target_lfs_len int := 0;
  _origin text;
  _lf_filter uuid;
  _scope text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  IF NEW.job_type NOT IN ('package_auto_seed_exam_blueprints','package_generate_blueprint_variants') THEN
    RETURN NEW;
  END IF;

  _is_targeted_fill := (
    COALESCE(NEW.payload->>'mode','') = 'targeted_blueprint_fill'
    OR COALESCE((NEW.payload->>'continuation_of_targeted_fill')::boolean, false) = true
  );

  IF _is_targeted_fill THEN
    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_targeted_bypass',
      jsonb_build_object(
        'package_id', NULLIF(NEW.payload->>'package_id','')::uuid,
        'job_type', NEW.job_type,
        'mode', NEW.payload->>'mode',
        'targets', jsonb_array_length(COALESCE(NEW.payload->'target_competency_ids','[]'::jsonb))
      )
    );
    RETURN NEW;
  END IF;

  _origin := NEW.payload->>'_origin';
  IF NEW.job_type = 'package_auto_seed_exam_blueprints'
     AND _origin = 'wave_heal_lf_coverage'
     AND jsonb_typeof(NEW.payload->'target_lfs') = 'array' THEN
    _target_lfs_len := jsonb_array_length(NEW.payload->'target_lfs');
    IF _target_lfs_len > 0 THEN
      BEGIN
        PERFORM public.fn_emit_audit(
          'redundant_seeding_wave_heal_lf_bypass',
          'package',
          COALESCE(NEW.package_id::text, NEW.payload->>'package_id', 'unknown'),
          'success',
          jsonb_build_object(
            'job_type', NEW.job_type,
            'package_id', NEW.package_id,
            'origin', _origin,
            'target_lfs', NEW.payload->'target_lfs',
            'target_lfs_count', _target_lfs_len,
            'mode', NEW.payload->>'mode'
          ),
          'fn_guard_redundant_seeding',
          'Narrow bypass: wave_heal_lf_coverage with non-empty target_lfs'
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
      RETURN NEW;
    END IF;
  END IF;

  _pkg_id := COALESCE(NEW.package_id, NULLIF(NEW.payload->>'package_id','')::uuid);
  IF _pkg_id IS NULL THEN RETURN NEW; END IF;

  SELECT cp.curriculum_id INTO _curriculum_id FROM public.course_packages cp WHERE cp.id = _pkg_id;
  IF _curriculum_id IS NULL THEN RETURN NEW; END IF;

  _step_key := substring(NEW.job_type FROM 9);
  _lf_filter := NULLIF(NEW.payload->>'learning_field_filter','')::uuid;
  _scope := CASE WHEN _lf_filter IS NULL THEN 'package' ELSE 'lf' END;

  IF NEW.job_type = 'package_auto_seed_exam_blueprints' THEN
    IF _lf_filter IS NULL THEN
      SELECT count(*) INTO _bp_count FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id AND qb.status IN ('approved','review');
    ELSE
      SELECT count(*) INTO _bp_count FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id AND qb.learning_field_id = _lf_filter
        AND qb.status IN ('approved','review');
    END IF;
    _is_truth := (_bp_count >= _required_min);
    _reason := CASE
      WHEN _is_truth AND _scope='lf' THEN 'REDUNDANT_LF_BLUEPRINTS_PRESENT'
      WHEN _is_truth THEN 'REDUNDANT_PACKAGE_BLUEPRINTS_PRESENT'
      ELSE 'BLUEPRINTS_INSUFFICIENT'
    END;
  ELSIF NEW.job_type = 'package_generate_blueprint_variants' THEN
    IF _lf_filter IS NULL THEN
      SELECT count(*) INTO _variant_count
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id;
      SELECT count(*) INTO _bp_count FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id AND qb.status IN ('approved','review');
      SELECT COALESCE(count(DISTINCT v.blueprint_id)::numeric / NULLIF(_bp_count, 0), 0) INTO _coverage
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id;
    ELSE
      SELECT count(*) INTO _variant_count
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id AND qb.learning_field_id = _lf_filter;
      SELECT count(*) INTO _bp_count FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id AND qb.learning_field_id = _lf_filter
        AND qb.status IN ('approved','review');
      SELECT COALESCE(count(DISTINCT v.blueprint_id)::numeric / NULLIF(_bp_count, 0), 0) INTO _coverage
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id AND qb.learning_field_id = _lf_filter;
    END IF;
    _is_truth := (_variant_count >= 10 AND _bp_count > 0 AND _coverage >= 0.8);
    _reason := CASE
      WHEN _is_truth AND _scope='lf' THEN 'REDUNDANT_LF_VARIANTS_PRESENT'
      WHEN _is_truth THEN 'REDUNDANT_PACKAGE_VARIANTS_PRESENT'
      ELSE 'VARIANTS_INSUFFICIENT'
    END;
  END IF;

  IF _is_truth THEN
    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_suppressed_no_step_mutation',
      jsonb_build_object(
        'package_id', _pkg_id, 'curriculum_id', _curriculum_id, 'job_type', NEW.job_type,
        'step_key', _step_key, 'reason', _reason, 'scope', _scope,
        'learning_field_id', _lf_filter, 'blueprints', _bp_count,
        'variants', _variant_count, 'coverage', _coverage
      )
    );

    BEGIN
      PERFORM public.fn_emit_audit(
        'job_queue_insert_suppressed_redundant_seeding',
        'package',
        _pkg_id::text,
        'skipped',
        jsonb_build_object(
          'reason', _reason,
          'scope', _scope,
          'job_type', NEW.job_type,
          'step_key', _step_key,
          'package_id', _pkg_id,
          'curriculum_id', _curriculum_id,
          'blueprints', _bp_count,
          'variants', _variant_count,
          'coverage', _coverage,
          'learning_field_id', _lf_filter,
          'origin', _origin,
          'ssot', 'ops_guardrail_events',
          'mirror_of', 'fn_guard_redundant_seeding'
        ),
        'fn_guard_redundant_seeding',
        format('Suppressed %s (%s scope): %s (bp=%s, variants=%s)',
               NEW.job_type, _scope, _reason, _bp_count, _variant_count)
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN NULL;
  END IF;

  PERFORM public.fn_log_guardrail_event(
    'redundant_seeding_passthrough',
    jsonb_build_object(
      'package_id', _pkg_id, 'curriculum_id', _curriculum_id, 'job_type', NEW.job_type,
      'step_key', _step_key, 'reason', _reason, 'scope', _scope,
      'learning_field_id', _lf_filter, 'blueprints', _bp_count,
      'variants', _variant_count, 'coverage', _coverage
    )
  );
  RETURN NEW;
END;
$function$;

-- =============================================================================
-- PART 2: SEO Cornerstone Enrichment Targets v1
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.seo_cornerstone_enrichment_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  rank int NOT NULL,
  blog_article_id uuid NOT NULL,
  blog_slug text,
  blog_title text,
  cornerstone_score numeric,
  word_count int,
  gap_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  gap_count int NOT NULL DEFAULT 0,
  s_depth numeric, s_faq numeric, s_quality numeric, s_hero numeric,
  s_anchor numeric, s_winner numeric, s_views numeric, s_perf numeric
);

CREATE INDEX IF NOT EXISTS idx_seo_cornerstone_targets_snapshot
  ON public.seo_cornerstone_enrichment_targets (snapshot_id, rank);
CREATE INDEX IF NOT EXISTS idx_seo_cornerstone_targets_blog
  ON public.seo_cornerstone_enrichment_targets (blog_article_id, snapshotted_at DESC);

ALTER TABLE public.seo_cornerstone_enrichment_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read enrichment targets" ON public.seo_cornerstone_enrichment_targets;
CREATE POLICY "admins read enrichment targets"
  ON public.seo_cornerstone_enrichment_targets
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Audit contract
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'cornerstone_enrichment_targets_snapshotted',
  ARRAY['snapshot_id','count','top_score','avg_gaps'],
  'admin_seo_cornerstone_snapshot_top_targets'
)
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module = EXCLUDED.owner_module;

-- Snapshot RPC
CREATE OR REPLACE FUNCTION public.admin_seo_cornerstone_snapshot_top_targets(_n int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot_id uuid := gen_random_uuid();
  v_count int := 0;
  v_top numeric;
  v_avg_gaps numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH ranked AS (
    SELECT
      row_number() OVER (ORDER BY cornerstone_score DESC NULLS LAST, blog_article_id) AS rnk,
      blog_article_id, blog_slug, blog_title, cornerstone_score, word_count,
      s_depth, s_faq, s_quality, s_hero, s_anchor, s_winner, s_views, s_perf,
      (CASE WHEN COALESCE(s_depth,0)   < 0.6 THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(s_faq,0)    < 0.6 THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(s_quality,0)< 0.6 THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(s_hero,0)   < 0.6 THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(s_anchor,0) < 0.6 THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(s_winner,0) < 0.6 THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(s_views,0)  < 0.6 THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(s_perf,0)   < 0.6 THEN 1 ELSE 0 END) AS gap_n
    FROM public.v_cornerstone_blog_score
  ), gaps AS (
    SELECT r.*,
      COALESCE((SELECT jsonb_agg(dim) FROM (
        SELECT 'depth'::text   AS dim WHERE COALESCE(r.s_depth,0)   < 0.6 UNION ALL
        SELECT 'faq'     WHERE COALESCE(r.s_faq,0)    < 0.6 UNION ALL
        SELECT 'quality' WHERE COALESCE(r.s_quality,0)< 0.6 UNION ALL
        SELECT 'hero'    WHERE COALESCE(r.s_hero,0)   < 0.6 UNION ALL
        SELECT 'anchor'  WHERE COALESCE(r.s_anchor,0) < 0.6 UNION ALL
        SELECT 'winner'  WHERE COALESCE(r.s_winner,0) < 0.6 UNION ALL
        SELECT 'views'   WHERE COALESCE(r.s_views,0)  < 0.6 UNION ALL
        SELECT 'perf'    WHERE COALESCE(r.s_perf,0)   < 0.6
      ) d), '[]'::jsonb) AS gap_dims
    FROM ranked r
    WHERE r.rnk <= _n
  )
  INSERT INTO public.seo_cornerstone_enrichment_targets (
    snapshot_id, rank, blog_article_id, blog_slug, blog_title,
    cornerstone_score, word_count, gap_dimensions, gap_count,
    s_depth, s_faq, s_quality, s_hero, s_anchor, s_winner, s_views, s_perf
  )
  SELECT v_snapshot_id, rnk, blog_article_id, blog_slug, blog_title,
         cornerstone_score, word_count, gap_dims, gap_n,
         s_depth, s_faq, s_quality, s_hero, s_anchor, s_winner, s_views, s_perf
  FROM gaps;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT max(cornerstone_score), avg(gap_count)
    INTO v_top, v_avg_gaps
  FROM public.seo_cornerstone_enrichment_targets
  WHERE snapshot_id = v_snapshot_id;

  PERFORM public.fn_emit_audit(
    'cornerstone_enrichment_targets_snapshotted',
    'system',
    v_snapshot_id::text,
    'success',
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'count', v_count,
      'top_score', v_top,
      'avg_gaps', v_avg_gaps,
      'n_requested', _n
    ),
    'admin_seo_cornerstone_snapshot_top_targets',
    format('Snapshotted %s cornerstone targets', v_count)
  );

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'count', v_count,
    'top_score', v_top,
    'avg_gaps', v_avg_gaps
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_seo_cornerstone_snapshot_top_targets(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_cornerstone_snapshot_top_targets(int) TO authenticated;

-- Summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_cornerstone_enrichment_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_latest uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT snapshot_id INTO v_latest
  FROM public.seo_cornerstone_enrichment_targets
  ORDER BY snapshotted_at DESC LIMIT 1;

  IF v_latest IS NULL THEN
    RETURN jsonb_build_object('has_snapshot', false);
  END IF;

  SELECT jsonb_build_object(
    'has_snapshot', true,
    'snapshot_id', v_latest,
    'snapshotted_at', max(snapshotted_at),
    'count', count(*),
    'top_score', max(cornerstone_score),
    'avg_score', avg(cornerstone_score),
    'avg_gaps', avg(gap_count),
    'gap_histogram', (
      SELECT jsonb_object_agg(dim, n)
      FROM (
        SELECT dim, count(*) AS n
        FROM public.seo_cornerstone_enrichment_targets t,
             jsonb_array_elements_text(t.gap_dimensions) AS dim
        WHERE t.snapshot_id = v_latest
        GROUP BY dim
      ) h
    ),
    'targets', (
      SELECT jsonb_agg(jsonb_build_object(
        'rank', rank,
        'blog_slug', blog_slug,
        'blog_title', blog_title,
        'cornerstone_score', cornerstone_score,
        'gap_count', gap_count,
        'gap_dimensions', gap_dimensions
      ) ORDER BY rank)
      FROM public.seo_cornerstone_enrichment_targets
      WHERE snapshot_id = v_latest
    )
  ) INTO v_result
  FROM public.seo_cornerstone_enrichment_targets
  WHERE snapshot_id = v_latest;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_cornerstone_enrichment_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_cornerstone_enrichment_summary() TO authenticated;
