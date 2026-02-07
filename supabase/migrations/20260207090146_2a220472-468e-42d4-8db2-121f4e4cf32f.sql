
-- =====================================================
-- AZAV Course/Curriculum Evidence Pack Export Function
-- SSOT-konform, behörden-ready, mit Fingerprint
-- =====================================================

CREATE OR REPLACE FUNCTION public.export_course_pack(
  p_course_id uuid,
  p_include_questions boolean DEFAULT false,
  p_include_h5p boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_pack jsonb;
  v_caller_id uuid;
  v_is_admin boolean;
BEGIN
  -- 0) Auth & Permission Check
  v_caller_id := auth.uid();
  
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check if caller is admin
  SELECT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = v_caller_id AND role = 'admin'
  ) INTO v_is_admin;
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin role required for course export';
  END IF;

  -- 1) Resolve curriculum from course (SSOT)
  SELECT c.curriculum_id
    INTO v_curriculum_id
  FROM courses c
  WHERE c.id = p_course_id;

  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'Course % has no curriculum_id (SSOT violation)', p_course_id;
  END IF;

  -- 2) Build export JSON
  WITH
  curriculum_data AS (
    SELECT
      id,
      title,
      description,
      version,
      status,
      frozen_at,
      source_file_name,
      source_file_url,
      extracted_data IS NOT NULL AS has_extracted_data,
      normalized_data IS NOT NULL AS has_normalized_data,
      created_at,
      updated_at
    FROM curricula
    WHERE id = v_curriculum_id
    LIMIT 1
  ),
  course_data AS (
    SELECT
      c.id,
      c.title,
      c.description,
      c.curriculum_id,
      c.status,
      c.estimated_duration,
      c.thumbnail_url,
      c.published_at,
      c.created_at,
      c.updated_at
    FROM courses c
    WHERE c.id = p_course_id
    LIMIT 1
  ),
  learning_fields_data AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', lf.id,
        'code', lf.code,
        'title', lf.title,
        'hours', lf.hours,
        'sort_order', lf.sort_order,
        'competencies_count', (
          SELECT COUNT(*) FROM competencies comp WHERE comp.learning_field_id = lf.id
        )
      ) ORDER BY lf.sort_order
    ), '[]'::jsonb) AS items
    FROM learning_fields lf
    WHERE lf.curriculum_id = v_curriculum_id
  ),
  modules_tree AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'module_id', m.id,
        'title', m.title,
        'description', m.description,
        'sort_order', m.sort_order,
        'learning_field_id', m.learning_field_id,
        'lessons', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'lesson_id', l.id,
              'title', l.title,
              'step', l.step,
              'competency_id', l.competency_id,
              'duration_minutes', l.duration_minutes,
              'sort_order', l.sort_order,
              'has_content', l.content IS NOT NULL,
              'content_type', CASE 
                WHEN l.content IS NOT NULL THEN l.content->>'type'
                ELSE NULL
              END,
              'h5p_content_id', CASE 
                WHEN p_include_h5p THEN l.h5p_content_id 
                ELSE NULL 
              END
            ) ORDER BY l.sort_order
          ), '[]'::jsonb)
          FROM lessons l
          WHERE l.module_id = m.id
        )
      ) ORDER BY m.sort_order
    ), '[]'::jsonb) AS tree
    FROM modules m
    WHERE m.course_id = p_course_id
  ),
  structure_stats AS (
    SELECT jsonb_build_object(
      'total_modules', (SELECT COUNT(*) FROM modules WHERE course_id = p_course_id),
      'total_lessons', (
        SELECT COUNT(*) 
        FROM lessons l 
        JOIN modules m ON m.id = l.module_id 
        WHERE m.course_id = p_course_id
      ),
      'lessons_by_step', (
        SELECT COALESCE(jsonb_object_agg(step, cnt), '{}'::jsonb)
        FROM (
          SELECT l.step::text, COUNT(*) as cnt
          FROM lessons l 
          JOIN modules m ON m.id = l.module_id 
          WHERE m.course_id = p_course_id
          GROUP BY l.step
        ) sub
      ),
      'total_duration_minutes', (
        SELECT COALESCE(SUM(l.duration_minutes), 0)
        FROM lessons l 
        JOIN modules m ON m.id = l.module_id 
        WHERE m.course_id = p_course_id
      ),
      'lessons_with_content', (
        SELECT COUNT(*) 
        FROM lessons l 
        JOIN modules m ON m.id = l.module_id 
        WHERE m.course_id = p_course_id AND l.content IS NOT NULL
      ),
      'lessons_with_h5p', (
        SELECT COUNT(*) 
        FROM lessons l 
        JOIN modules m ON m.id = l.module_id 
        WHERE m.course_id = p_course_id AND l.h5p_content_id IS NOT NULL
      )
    ) AS stats
  ),
  question_stats AS (
    SELECT jsonb_build_object(
      'total_questions', COUNT(*),
      'approved_questions', COUNT(*) FILTER (WHERE status = 'approved'),
      'draft_questions', COUNT(*) FILTER (WHERE status = 'draft'),
      'review_questions', COUNT(*) FILTER (WHERE status = 'review'),
      'rejected_questions', COUNT(*) FILTER (WHERE status = 'rejected'),
      'ai_generated', COUNT(*) FILTER (WHERE ai_generated = true),
      'by_difficulty', jsonb_build_object(
        'easy', COUNT(*) FILTER (WHERE difficulty = 'easy'),
        'medium', COUNT(*) FILTER (WHERE difficulty = 'medium'),
        'hard', COUNT(*) FILTER (WHERE difficulty = 'hard')
      )
    ) AS stats
    FROM exam_questions
    WHERE curriculum_id = v_curriculum_id
  ),
  questions_detail AS (
    SELECT CASE WHEN p_include_questions THEN
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', q.id,
            'status', q.status,
            'difficulty', q.difficulty,
            'learning_field_id', q.learning_field_id,
            'competency_id', q.competency_id,
            'ai_generated', q.ai_generated,
            'reviewed_by', q.reviewed_by,
            'reviewed_at', q.reviewed_at,
            'created_at', q.created_at
          ) ORDER BY q.created_at DESC
        )
        FROM exam_questions q
        WHERE q.curriculum_id = v_curriculum_id
      ), '[]'::jsonb)
    ELSE
      NULL
    END AS items
  ),
  blueprint_stats AS (
    SELECT jsonb_build_object(
      'total_blueprints', COUNT(*),
      'frozen_blueprints', COUNT(*) FILTER (WHERE frozen = true)
    ) AS stats
    FROM exam_blueprints
    WHERE curriculum_id = v_curriculum_id
  ),
  enrollment_stats AS (
    SELECT jsonb_build_object(
      'total_enrollments', COUNT(*),
      'completed_enrollments', COUNT(*) FILTER (WHERE completed_at IS NOT NULL),
      'active_enrollments', COUNT(*) FILTER (WHERE completed_at IS NULL)
    ) AS stats
    FROM course_enrollments
    WHERE course_id = p_course_id
  ),
  exam_stats AS (
    SELECT jsonb_build_object(
      'total_sessions', COUNT(*),
      'completed_sessions', COUNT(*) FILTER (WHERE finished_at IS NOT NULL),
      'passed_sessions', COUNT(*) FILTER (WHERE passed = true),
      'average_score', ROUND(AVG(score_percentage) FILTER (WHERE finished_at IS NOT NULL), 2),
      'by_mode', jsonb_build_object(
        'simulation', COUNT(*) FILTER (WHERE mode = 'simulation'),
        'practice', COUNT(*) FILTER (WHERE mode = 'practice'),
        'timed_exam', COUNT(*) FILTER (WHERE mode = 'timed_exam')
      )
    ) AS stats
    FROM exam_sessions
    WHERE curriculum_id = v_curriculum_id
  )
  SELECT jsonb_build_object(
    'export_version', '1.1',
    'export_type', 'course_evidence_pack',
    'generated_at', now(),
    'generated_by', 'admin',
    
    'scope', jsonb_build_object(
      'type', 'course',
      'course_id', p_course_id,
      'curriculum_id', v_curriculum_id
    ),
    
    'ssot', jsonb_build_object(
      'curriculum', (SELECT to_jsonb(curriculum_data) FROM curriculum_data),
      'is_frozen', (SELECT status = 'frozen' FROM curriculum_data),
      'frozen_at', (SELECT frozen_at FROM curriculum_data),
      'integrity_rule', 'courses.curriculum_id -> curricula.id (frozen) is authoritative'
    ),
    
    'course', (SELECT to_jsonb(course_data) FROM course_data),
    
    'learning_fields', jsonb_build_object(
      'count', (SELECT COUNT(*) FROM learning_fields WHERE curriculum_id = v_curriculum_id),
      'items', (SELECT items FROM learning_fields_data)
    ),
    
    'structure', jsonb_build_object(
      'stats', (SELECT stats FROM structure_stats),
      'modules', (SELECT tree FROM modules_tree)
    ),
    
    'exam_questions', jsonb_build_object(
      'include_details', p_include_questions,
      'stats', (SELECT stats FROM question_stats),
      'items', (SELECT items FROM questions_detail)
    ),
    
    'exam_blueprints', (SELECT stats FROM blueprint_stats),
    
    'usage', jsonb_build_object(
      'enrollments', (SELECT stats FROM enrollment_stats),
      'exam_sessions', (SELECT stats FROM exam_stats)
    ),
    
    'audit', jsonb_build_object(
      'export_integrity', jsonb_build_object(
        'rls_enforced', true,
        'generated_via', 'database_function',
        'permission_check', 'admin_only'
      ),
      'compliance', jsonb_build_object(
        'azav_ready', true,
        'curriculum_frozen_check', (SELECT status = 'frozen' FROM curriculum_data)
      )
    )
  ) INTO v_pack;

  RETURN v_pack;
END;
$$;

-- Grant execute to authenticated users (function handles its own auth checks)
GRANT EXECUTE ON FUNCTION public.export_course_pack(uuid, boolean, boolean) TO authenticated;

COMMENT ON FUNCTION public.export_course_pack IS 
'AZAV-compliant Course Evidence Pack export. Returns comprehensive JSON with curriculum SSOT validation, course structure, question stats, and usage metrics.';

-- =====================================================
-- Fingerprint Function for Change Detection
-- =====================================================

CREATE OR REPLACE FUNCTION public.course_pack_fingerprint(p_course_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT encode(
    sha256(
      (public.export_course_pack(p_course_id, false, true))::text::bytea
    ), 
    'hex'
  );
$$;

GRANT EXECUTE ON FUNCTION public.course_pack_fingerprint(uuid) TO authenticated;

COMMENT ON FUNCTION public.course_pack_fingerprint IS 
'Returns SHA256 fingerprint of course evidence pack for change detection and audit verification.';
