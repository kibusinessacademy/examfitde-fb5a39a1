
CREATE OR REPLACE FUNCTION public.fn_compute_minicheck_fingerprint(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_approved_count int;
  v_total_count int;
  v_trap_count int;
  v_lesson_hash text;
  v_bloom_hash text;
  v_mode_hash text;
  v_explanation_coverage numeric;
  v_fingerprint text;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'approved'),
         count(*),
         count(*) FILTER (WHERE trap_type IS NOT NULL AND status = 'approved')
  INTO v_approved_count, v_total_count, v_trap_count
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id;

  SELECT md5(string_agg(lesson_id::text || ':' || cnt::text, ',' ORDER BY lesson_id))
  INTO v_lesson_hash
  FROM (
    SELECT lesson_id, count(*) as cnt
    FROM minicheck_questions
    WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND lesson_id IS NOT NULL
    GROUP BY lesson_id
  ) sub;

  SELECT md5(string_agg(coalesce(cognitive_level, 'null') || ':' || cnt::text, ',' ORDER BY cognitive_level))
  INTO v_bloom_hash
  FROM (
    SELECT cognitive_level, count(*) as cnt
    FROM minicheck_questions
    WHERE curriculum_id = p_curriculum_id AND status = 'approved'
    GROUP BY cognitive_level
  ) sub;

  SELECT md5(string_agg(coalesce(mode, 'null') || ':' || cnt::text, ',' ORDER BY mode))
  INTO v_mode_hash
  FROM (
    SELECT mode, count(*) as cnt
    FROM minicheck_questions
    WHERE curriculum_id = p_curriculum_id AND status = 'approved'
    GROUP BY mode
  ) sub;

  SELECT CASE WHEN v_approved_count > 0
    THEN round(100.0 * count(*) FILTER (WHERE length(explanation) >= 40) / v_approved_count, 1)
    ELSE 0 END
  INTO v_explanation_coverage
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id AND status = 'approved';

  v_fingerprint := encode(
    digest(
      coalesce(v_approved_count::text, '0') || '|' ||
      coalesce(v_total_count::text, '0') || '|' ||
      coalesce(v_trap_count::text, '0') || '|' ||
      coalesce(v_lesson_hash, 'none') || '|' ||
      coalesce(v_bloom_hash, 'none') || '|' ||
      coalesce(v_mode_hash, 'none') || '|' ||
      coalesce(v_explanation_coverage::text, '0'),
      'sha256'
    ),
    'hex'
  );

  RETURN jsonb_build_object(
    'fingerprint', v_fingerprint,
    'approved_count', v_approved_count,
    'total_count', v_total_count,
    'trap_count', v_trap_count,
    'explanation_coverage_pct', v_explanation_coverage
  );
END;
$$;
