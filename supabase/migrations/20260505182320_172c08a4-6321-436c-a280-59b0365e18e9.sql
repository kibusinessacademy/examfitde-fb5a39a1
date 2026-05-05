
-- 1. Heal RPC for one course
CREATE OR REPLACE FUNCTION public.admin_heal_course_lessons(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_curriculum_id uuid;
  v_failed_reset int := 0;
  v_pending_count int := 0;
  v_job_id uuid;
  v_active_jobs int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT c.curriculum_id INTO v_curriculum_id FROM courses c WHERE c.id = _course_id;
  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;

  SELECT cp.id INTO v_package_id FROM course_packages cp
  WHERE cp.curriculum_id = v_curriculum_id ORDER BY (cp.status='published') DESC, cp.created_at DESC LIMIT 1;
  IF v_package_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  -- Anti-loop: skip if active job already exists
  SELECT COUNT(*) INTO v_active_jobs FROM job_queue
  WHERE package_id = v_package_id
    AND job_type IN ('package_generate_learning_content','package_repair_failed_lessons','lesson_generate_content')
    AND status IN ('pending','processing');
  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_jobs_exist', 'active_jobs', v_active_jobs, 'package_id', v_package_id);
  END IF;

  -- Reset failed lessons → pending
  WITH upd AS (
    UPDATE lessons SET generation_status='pending', updated_at=now()
    WHERE module_id IN (SELECT id FROM modules WHERE course_id=_course_id)
      AND generation_status='failed'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_failed_reset FROM upd;

  SELECT COUNT(*) INTO v_pending_count FROM lessons l JOIN modules m ON m.id=l.module_id
  WHERE m.course_id=_course_id AND l.generation_status='pending';

  -- Enqueue generate_learning_content job
  INSERT INTO job_queue (job_type, status, payload, package_id, worker_pool, lane)
  VALUES (
    'package_generate_learning_content',
    'pending',
    jsonb_build_object(
      'package_id', v_package_id,
      'curriculum_id', v_curriculum_id,
      'course_id', _course_id,
      'step_key', 'generate_learning_content',
      'enqueue_source', 'admin_heal_course_lessons',
      'triggered_by', 'softlaunch_promotion'
    ),
    v_package_id,
    'content',
    'content'
  )
  RETURNING id INTO v_job_id;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('launch_readiness_heal_course_lessons','course',_course_id,'success',
    jsonb_build_object('package_id', v_package_id, 'failed_reset', v_failed_reset,
                       'pending_total', v_pending_count, 'job_id', v_job_id));

  RETURN jsonb_build_object('ok', true, 'course_id', _course_id, 'package_id', v_package_id,
    'failed_reset', v_failed_reset, 'pending_total', v_pending_count, 'job_id', v_job_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_heal_course_lessons(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_course_lessons(uuid) TO authenticated;

-- 2. List softlaunch candidates
CREATE OR REPLACE FUNCTION public.admin_list_softlaunch_candidates(
  _min_lessons_ready int DEFAULT 50,
  _limit int DEFAULT 30
)
RETURNS TABLE(
  course_id uuid, course_title text, curriculum_id uuid,
  product_id uuid, product_slug text, visibility text,
  modules int, lessons int, lessons_ready int, lessons_pending int, lessons_failed int,
  package_id uuid, package_status text, has_active_jobs boolean,
  is_currently_sellable boolean, is_promotable boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH cm AS (
    SELECT c.id course_id, c.title course_title, c.curriculum_id,
      COUNT(DISTINCT m.id)::int modules,
      COUNT(DISTINCT l.id)::int lessons,
      COUNT(DISTINCT l.id) FILTER (WHERE l.generation_status='completed' OR l.status='ready')::int lessons_ready,
      COUNT(DISTINCT l.id) FILTER (WHERE l.generation_status='pending')::int lessons_pending,
      COUNT(DISTINCT l.id) FILTER (WHERE l.generation_status='failed')::int lessons_failed
    FROM courses c
    LEFT JOIN modules m ON m.course_id=c.id
    LEFT JOIN lessons l ON l.module_id=m.id
    WHERE c.status='published'
    GROUP BY c.id, c.title, c.curriculum_id
  ),
  pp AS (
    SELECT p.id product_id, p.slug, p.visibility, p.curriculum_id,
      bool_or(pr.stripe_price_id IS NOT NULL) has_stripe
    FROM products p JOIN product_prices pr ON pr.product_id=p.id AND pr.active=true
    WHERE p.status='active' AND p.slug IS NOT NULL
    GROUP BY p.id, p.slug, p.visibility, p.curriculum_id
  ),
  pkg AS (
    SELECT DISTINCT ON (cp.curriculum_id) cp.curriculum_id, cp.id pkg_id, cp.status pkg_status
    FROM course_packages cp ORDER BY cp.curriculum_id, (cp.status='published') DESC, cp.created_at DESC
  )
  SELECT cm.course_id, cm.course_title, cm.curriculum_id,
    pp.product_id, pp.slug, pp.visibility,
    cm.modules, cm.lessons, cm.lessons_ready, cm.lessons_pending, cm.lessons_failed,
    pkg.pkg_id, pkg.pkg_status,
    EXISTS(SELECT 1 FROM job_queue jq WHERE jq.package_id=pkg.pkg_id
      AND jq.job_type IN ('package_generate_learning_content','package_repair_failed_lessons','lesson_generate_content')
      AND jq.status IN ('pending','processing')) AS has_active_jobs,
    (cm.modules>0 AND cm.lessons_ready>0 AND pp.has_stripe AND pp.visibility='public') AS is_currently_sellable,
    (cm.modules>0 AND cm.lessons_ready>=_min_lessons_ready AND pp.has_stripe AND pp.visibility!='public') AS is_promotable
  FROM cm
  JOIN pp ON pp.curriculum_id=cm.curriculum_id
  LEFT JOIN pkg ON pkg.curriculum_id=cm.curriculum_id
  WHERE pp.has_stripe
  ORDER BY cm.lessons_ready DESC, cm.lessons DESC
  LIMIT _limit;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_softlaunch_candidates(int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_softlaunch_candidates(int,int) TO authenticated;

-- 3. Set product visibility with audit
CREATE OR REPLACE FUNCTION public.admin_set_product_visibility(
  _product_id uuid, _visibility text, _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_slug text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF _visibility NOT IN ('public','private') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_visibility');
  END IF;

  SELECT visibility, slug INTO v_old, v_slug FROM products WHERE id=_product_id;
  IF v_old IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  UPDATE products SET visibility=_visibility, updated_at=now() WHERE id=_product_id;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('launch_readiness_visibility_change','product',_product_id,'success',
    jsonb_build_object('slug', v_slug, 'old', v_old, 'new', _visibility, 'reason', COALESCE(_reason,'admin_ui'),
                       'actor', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'product_id', _product_id, 'old', v_old, 'new', _visibility);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_product_visibility(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_product_visibility(uuid,text,text) TO authenticated;
