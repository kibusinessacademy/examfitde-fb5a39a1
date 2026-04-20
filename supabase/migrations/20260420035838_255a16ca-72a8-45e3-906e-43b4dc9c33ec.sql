-- Fix #1: finalize_learning_content (qualify ps.meta + add ok/executed)
CREATE OR REPLACE FUNCTION public.fn_prebuild_finalize_learning_content(p_package_id uuid)
RETURNS TABLE(status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_course_id uuid; v_curriculum_id uuid;
  v_fanout_step_status text; v_gen_step_status text; v_fin_step_status text;
  v_total_shards int; v_completed_shards int; v_failed_shards int; v_pending_shards int;
  v_total_lessons int; v_lessons_with_content int; v_avg_len numeric; v_coverage numeric;
  v_active_jobs int; v_now timestamptz := now();
BEGIN
  SELECT ps.status::text INTO v_fin_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='finalize_learning_content';
  IF v_fin_step_status='done' THEN
    RETURN QUERY SELECT 'noop'::text,false,'ALREADY_DONE'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text INTO v_fanout_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='fanout_learning_content';
  IF v_fanout_step_status IS NOT NULL AND v_fanout_step_status NOT IN ('done','skipped') THEN
    RETURN QUERY SELECT 'deferred'::text,false,'PREREQ_FANOUT_NOT_DONE'::text,
      jsonb_build_object('fanout_status',v_fanout_step_status); RETURN;
  END IF;

  SELECT ps.status::text INTO v_gen_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='generate_learning_content';
  IF v_gen_step_status IS NOT NULL AND v_gen_step_status NOT IN ('done','skipped') THEN
    RETURN QUERY SELECT 'deferred'::text,false,'PREREQ_GENERATE_NOT_DONE'::text,
      jsonb_build_object('generate_status',v_gen_step_status); RETURN;
  END IF;

  SELECT cp.course_id, cp.curriculum_id INTO v_course_id, v_curriculum_id
   FROM course_packages cp WHERE cp.id=p_package_id;
  IF v_course_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text,false,'NO_COURSE_ID'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT count(*) INTO v_active_jobs FROM job_queue jq
    WHERE jq.package_id=p_package_id
      AND jq.job_type IN ('package_finalize_learning_content','lesson_generate_content_shard',
                           'package_fanout_learning_content','package_generate_learning_content')
      AND jq.status IN ('pending','processing','running','batch_pending','claimed','queued');
  IF v_active_jobs>0 THEN
    RETURN QUERY SELECT 'deferred'::text,false,'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs',v_active_jobs); RETURN;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE pcs.status IN ('completed','done')),
         count(*) FILTER (WHERE pcs.status='failed'),
         count(*) FILTER (WHERE pcs.status IN ('pending','processing','claimed'))
   INTO v_total_shards, v_completed_shards, v_failed_shards, v_pending_shards
   FROM package_content_shards pcs WHERE pcs.package_id=p_package_id;
  IF v_total_shards>0 AND (v_pending_shards>0 OR v_failed_shards>0) THEN
    RETURN QUERY SELECT 'deferred'::text,false,'SHARDS_INCOMPLETE'::text,
      jsonb_build_object('total',v_total_shards,'completed',v_completed_shards,
                         'failed',v_failed_shards,'pending',v_pending_shards); RETURN;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE l.content IS NOT NULL AND l.content::text!='null'
                          AND length(l.content::text)>=300
                          AND NOT (l.content::jsonb ? '_placeholder' AND (l.content::jsonb->>'_placeholder')::boolean=true)),
         coalesce(avg(CASE WHEN l.content IS NOT NULL AND length(l.content::text)>=300 THEN length(l.content::text) ELSE NULL END),0)
   INTO v_total_lessons, v_lessons_with_content, v_avg_len
   FROM lessons l JOIN modules m ON m.id=l.module_id
   WHERE m.course_id=v_course_id AND l.step!='mini_check';
  IF v_total_lessons=0 THEN
    RETURN QUERY SELECT 'deferred'::text,false,'NO_LESSONS'::text,'{}'::jsonb; RETURN;
  END IF;
  v_coverage := v_lessons_with_content::numeric / v_total_lessons;
  IF v_coverage < 0.90 OR v_avg_len < 600 THEN
    RETURN QUERY SELECT 'deferred'::text,false,'COVERAGE_INSUFFICIENT'::text,
      jsonb_build_object('total_lessons',v_total_lessons,'with_content',v_lessons_with_content,
                         'coverage_pct',round(v_coverage*100,1),'avg_len',round(v_avg_len)); RETURN;
  END IF;

  PERFORM 1 FROM lessons l JOIN modules m ON m.id=l.module_id
   WHERE m.course_id=v_course_id AND l.qc_status='tier1_failed' AND l.step!='mini_check' LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'deferred'::text,false,'TIER1_FAILED_LESSONS'::text,'{}'::jsonb; RETURN;
  END IF;

  UPDATE package_steps ps SET
    status='done', finished_at=v_now, last_error=NULL,
    started_at=coalesce(ps.started_at, v_now),
    meta = coalesce(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'ok',true,'executed',true,
      'prebuild',true,'prebuild_fn','fn_prebuild_finalize_learning_content',
      'postcondition_verified',true,'checked_at',v_now::text,
      'total_lessons',v_total_lessons,'with_content',v_lessons_with_content,
      'coverage_pct',round(v_coverage*100,1),'avg_len',round(v_avg_len),
      'reason','PREBUILD_FINALIZE_ONLY')
  WHERE ps.package_id=p_package_id AND ps.step_key='finalize_learning_content' AND ps.status::text!='done';

  RETURN QUERY SELECT 'done'::text,true,'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object('total_lessons',v_total_lessons,'with_content',v_lessons_with_content,
                       'coverage_pct',round(v_coverage*100,1),'avg_len',round(v_avg_len));
END;
$$;

-- Fix #2: validate_handbook (qualify ps.meta + add ok/executed)
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_handbook(p_package_id uuid)
RETURNS TABLE(status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_curriculum_id uuid; v_step_status text; v_generate_status text; v_expand_status text;
  v_pkg_status text; v_gen_last_error text; v_active_jobs int := 0;
  v_chapter_count int := 0; v_section_count int := 0;
  v_with_basis int := 0; v_with_expanded int := 0; v_with_any_content int := 0; v_empty_sections int := 0;
  v_failed_generate boolean := false; v_poison_blocked boolean := false; v_threshold_fail boolean := false;
  v_now timestamptz := now();
BEGIN
  SELECT cp.curriculum_id, cp.status INTO v_curriculum_id, v_pkg_status
   FROM course_packages cp WHERE cp.id=p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text,false,'NO_CURRICULUM_ID'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text INTO v_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='validate_handbook';
  IF v_step_status IS NULL THEN
    RETURN QUERY SELECT 'noop'::text,false,'STEP_NOT_FOUND'::text,'{}'::jsonb; RETURN;
  END IF;
  IF v_step_status='done' THEN
    RETURN QUERY SELECT 'noop'::text,false,'ALREADY_DONE'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text, ps.last_error INTO v_generate_status, v_gen_last_error
   FROM package_steps ps WHERE ps.package_id=p_package_id AND ps.step_key='generate_handbook';
  IF v_generate_status IS NOT NULL AND v_generate_status NOT IN ('done','skipped') THEN
    RETURN QUERY SELECT 'deferred'::text,false,'PREREQ_GENERATE_HANDBOOK_NOT_DONE'::text,
      jsonb_build_object('generate_handbook_status',v_generate_status,'last_error',v_gen_last_error); RETURN;
  END IF;

  SELECT ps.status::text INTO v_expand_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='expand_handbook';

  SELECT count(*) INTO v_active_jobs FROM job_queue jq
    WHERE jq.package_id=p_package_id
      AND jq.job_type IN ('package_generate_handbook','package_validate_handbook','package_expand_handbook')
      AND jq.status IN ('pending','queued','claimed','processing','running','batch_pending');
  IF v_active_jobs>0 THEN
    RETURN QUERY SELECT 'deferred'::text,false,'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs',v_active_jobs); RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=p_package_id
                  AND ps.step_key='generate_handbook' AND ps.status::text IN ('failed','blocked')) INTO v_failed_generate;
  SELECT EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=p_package_id AND ps.step_key='generate_handbook'
                  AND (ps.last_error ILIKE '%poison%' OR coalesce(ps.meta->>'blocked_reason','') ILIKE '%poison%')) INTO v_poison_blocked;
  SELECT EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=p_package_id AND ps.step_key='generate_handbook'
                  AND (ps.last_error ILIKE '%THRESHOLD_FAIL%' OR coalesce(ps.meta->>'blocked_reason','') ILIKE '%THRESHOLD_FAIL%')) INTO v_threshold_fail;

  IF v_poison_blocked THEN
    RETURN QUERY SELECT 'blocked'::text,false,'POISON_LOOP_BLOCKED'::text,
      jsonb_build_object('generate_handbook_status',v_generate_status); RETURN;
  END IF;
  IF v_threshold_fail THEN
    RETURN QUERY SELECT 'blocked'::text,false,'THRESHOLD_FAIL_PRESENT'::text,
      jsonb_build_object('generate_handbook_status',v_generate_status); RETURN;
  END IF;
  IF v_failed_generate THEN
    RETURN QUERY SELECT 'blocked'::text,false,'GENERATE_HANDBOOK_FAILED'::text,
      jsonb_build_object('generate_handbook_status',v_generate_status); RETURN;
  END IF;

  SELECT count(*) INTO v_chapter_count FROM handbook_chapters hc WHERE hc.curriculum_id=v_curriculum_id;
  SELECT count(*),
         count(*) FILTER (WHERE hs.basis_content IS NOT NULL AND length(trim(hs.basis_content))>0),
         count(*) FILTER (WHERE hs.expanded_content IS NOT NULL AND length(trim(hs.expanded_content))>0),
         count(*) FILTER (WHERE (hs.basis_content IS NOT NULL AND length(trim(hs.basis_content))>0)
                                 OR (hs.expanded_content IS NOT NULL AND length(trim(hs.expanded_content))>0)),
         count(*) FILTER (WHERE coalesce(length(trim(hs.basis_content)),0)=0 AND coalesce(length(trim(hs.expanded_content)),0)=0)
   INTO v_section_count, v_with_basis, v_with_expanded, v_with_any_content, v_empty_sections
   FROM handbook_sections hs JOIN handbook_chapters hc ON hc.id=hs.chapter_id
   WHERE hc.curriculum_id=v_curriculum_id;

  IF v_chapter_count=0 THEN
    RETURN QUERY SELECT 'blocked'::text,false,'NO_HANDBOOK_CHAPTERS'::text,
      jsonb_build_object('curriculum_id',v_curriculum_id); RETURN;
  END IF;
  IF v_section_count=0 THEN
    RETURN QUERY SELECT 'blocked'::text,false,'NO_HANDBOOK_SECTIONS'::text,
      jsonb_build_object('chapter_count',v_chapter_count); RETURN;
  END IF;
  IF v_with_any_content < v_section_count THEN
    RETURN QUERY SELECT 'blocked'::text,false,'HANDBOOK_SECTION_CONTENT_INCOMPLETE'::text,
      jsonb_build_object('section_count',v_section_count,'with_any_content',v_with_any_content,
                         'empty_sections',v_empty_sections); RETURN;
  END IF;

  UPDATE package_steps ps SET
    status='done', finished_at=v_now, last_error=NULL,
    started_at=coalesce(ps.started_at, v_now),
    meta = coalesce(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'ok',true,'executed',true,
      'prebuild',true,'prebuild_fn','fn_prebuild_validate_handbook',
      'postcondition_verified',true,'checked_at',v_now::text,
      'chapter_count',v_chapter_count,'section_count',v_section_count,
      'with_basis',v_with_basis,'with_expanded',v_with_expanded,
      'with_any_content',v_with_any_content,'empty_sections',v_empty_sections,
      'reason','PREBUILD_HANDBOOK_STRUCTURE_VALID')
  WHERE ps.package_id=p_package_id AND ps.step_key='validate_handbook' AND ps.status::text!='done';

  RETURN QUERY SELECT 'done'::text,true,'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object('chapter_count',v_chapter_count,'section_count',v_section_count);
END;
$$;

-- Fix #3: validate_handbook_depth (qualify ps.meta + add ok/executed)
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_handbook_depth(p_package_id uuid)
RETURNS TABLE(status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_curriculum_id uuid; v_step_status text; v_expand_status text; v_active_jobs int;
  v_section_count int; v_expanded_count int; v_scored_count int;
  v_expand_coverage numeric; v_avg_depth_score numeric; v_scored_coverage numeric;
  v_quality_tier text; v_now timestamptz := now();
  C_MIN_EXPAND_COV constant numeric := 50;
  C_MIN_DEPTH_SCORE constant numeric := 40;
  C_MIN_SCORED_COV constant numeric := 50;
BEGIN
  SELECT ps.status::text INTO v_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='validate_handbook_depth';
  IF v_step_status='done' THEN
    RETURN QUERY SELECT 'noop'::text,false,'ALREADY_DONE'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id=p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text,false,'NO_CURRICULUM_ID'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text INTO v_expand_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='expand_handbook';
  IF v_expand_status IS NOT NULL AND v_expand_status NOT IN ('done','skipped') THEN
    RETURN QUERY SELECT 'deferred'::text,false,'PREREQ_EXPAND_NOT_DONE'::text,
      jsonb_build_object('expand_handbook_status',v_expand_status); RETURN;
  END IF;

  SELECT count(*) INTO v_active_jobs FROM job_queue jq
    WHERE jq.package_id=p_package_id
      AND jq.job_type IN ('package_expand_handbook','package_validate_handbook_depth')
      AND jq.status IN ('pending','queued','claimed','processing','running','batch_pending');
  IF v_active_jobs>0 THEN
    RETURN QUERY SELECT 'deferred'::text,false,'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs',v_active_jobs); RETURN;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE hs.expand_status='done' AND hs.expanded_content IS NOT NULL AND length(hs.expanded_content)>0),
         count(*) FILTER (WHERE hs.quality_score IS NOT NULL AND hs.quality_score>0),
         coalesce(avg(hs.quality_score) FILTER (WHERE hs.quality_score IS NOT NULL AND hs.quality_score>0),0)
   INTO v_section_count, v_expanded_count, v_scored_count, v_avg_depth_score
   FROM handbook_sections hs JOIN handbook_chapters hc ON hc.id=hs.chapter_id
   WHERE hc.curriculum_id=v_curriculum_id;

  IF v_section_count=0 THEN
    RETURN QUERY SELECT 'blocked'::text,false,'NO_SECTIONS'::text,'{}'::jsonb; RETURN;
  END IF;
  v_expand_coverage := round((v_expanded_count::numeric/v_section_count)*100,1);
  v_scored_coverage := round((v_scored_count::numeric/v_section_count)*100,1);

  IF v_scored_count=0 THEN
    RETURN QUERY SELECT 'blocked'::text,false,'NO_SCORED_SECTIONS'::text,
      jsonb_build_object('section_count',v_section_count,'expanded_sections',v_expanded_count); RETURN;
  END IF;
  IF v_scored_coverage < C_MIN_SCORED_COV THEN
    RETURN QUERY SELECT 'blocked'::text,false,'SCORED_COVERAGE_INSUFFICIENT'::text,
      jsonb_build_object('scored_coverage_pct',v_scored_coverage); RETURN;
  END IF;
  IF v_expand_coverage<C_MIN_EXPAND_COV OR v_avg_depth_score<C_MIN_DEPTH_SCORE THEN
    RETURN QUERY SELECT 'blocked'::text,false,'DEPTH_THRESHOLD_NOT_MET'::text,
      jsonb_build_object('expand_coverage_pct',v_expand_coverage,'avg_depth_score',round(v_avg_depth_score,1)); RETURN;
  END IF;

  IF v_expand_coverage>=90 AND v_avg_depth_score>=75 THEN v_quality_tier:='elite';
  ELSIF v_expand_coverage>=50 AND v_avg_depth_score>=40 THEN v_quality_tier:='enhanced';
  ELSE v_quality_tier:='standard'; END IF;

  UPDATE package_steps ps SET
    status='done', finished_at=v_now, last_error=NULL,
    started_at=coalesce(ps.started_at, v_now),
    meta = coalesce(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'ok',true,'executed',true,
      'prebuild',true,'prebuild_fn','fn_prebuild_validate_handbook_depth',
      'postcondition_verified',true,'checked_at',v_now::text,
      'quality_tier',v_quality_tier,'section_count',v_section_count,
      'expanded_sections',v_expanded_count,'scored_sections',v_scored_count,
      'expand_coverage_pct',v_expand_coverage,'scored_coverage_pct',v_scored_coverage,
      'avg_depth_score',round(v_avg_depth_score,1),
      'reason','PREBUILD_HANDBOOK_DEPTH_VALID')
  WHERE ps.package_id=p_package_id AND ps.step_key='validate_handbook_depth' AND ps.status::text!='done';

  RETURN QUERY SELECT 'done'::text,true,'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object('quality_tier',v_quality_tier,'section_count',v_section_count,
                       'expand_coverage_pct',v_expand_coverage,'scored_coverage_pct',v_scored_coverage);
END;
$$;

-- Fix #4: validate_blueprint_variants (add ok/executed)
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_blueprint_variants(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_current_status text; v_curriculum_id uuid;
  v_total_variants bigint; v_review_or_better bigint; v_total_blueprints bigint;
  v_now text := now()::text;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id=p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text,false,'PACKAGE_NOT_FOUND'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text INTO v_current_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='validate_blueprint_variants';
  IF v_current_status IS NULL OR v_current_status='done' THEN
    RETURN QUERY SELECT 'noop'::text,false,'ALREADY_DONE_OR_MISSING'::text,'{}'::jsonb; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM package_steps ps2
    WHERE ps2.package_id=p_package_id AND ps2.step_key='generate_blueprint_variants' AND ps2.status::text='done')
  THEN
    RETURN QUERY SELECT 'blocked'::text,false,'PREREQ_NOT_MET'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT COUNT(*) INTO v_total_variants FROM exam_question_variants eqv
   WHERE eqv.curriculum_id=v_curriculum_id;
  SELECT COUNT(*) INTO v_review_or_better FROM exam_question_variants eqv
   WHERE eqv.curriculum_id=v_curriculum_id AND eqv.status::text IN ('review','approved','promoted');
  SELECT COUNT(*) INTO v_total_blueprints FROM exam_blueprints eb
   WHERE eb.curriculum_id=v_curriculum_id;

  IF v_total_variants>=6 AND v_review_or_better>=1 THEN
    UPDATE package_steps ps_upd SET
      status='done', finished_at=v_now::timestamptz, updated_at=v_now::timestamptz,
      started_at=coalesce(ps_upd.started_at, v_now::timestamptz),
      meta = COALESCE(ps_upd.meta,'{}'::jsonb) || jsonb_build_object(
        'ok',true,'executed',true,
        'prebuild',true,'prebuild_fn','fn_prebuild_validate_blueprint_variants',
        'adopted',true,'adopted_from_ssot',true,
        'postcondition_verified',true,
        'total_variants',v_total_variants,'review_or_better',v_review_or_better,
        'total_blueprints',v_total_blueprints,'checked_at',v_now)
    WHERE ps_upd.package_id=p_package_id AND ps_upd.step_key='validate_blueprint_variants'
      AND ps_upd.status::text!='done';

    RETURN QUERY SELECT 'done'::text,true,'ADOPTED_FROM_SSOT'::text,
      jsonb_build_object('total_variants',v_total_variants,'review_or_better',v_review_or_better);
    RETURN;
  END IF;

  RETURN QUERY SELECT 'pending'::text,false,'INSUFFICIENT_VARIANTS'::text,
    jsonb_build_object('total_variants',v_total_variants,'review_or_better',v_review_or_better);
END;
$$;