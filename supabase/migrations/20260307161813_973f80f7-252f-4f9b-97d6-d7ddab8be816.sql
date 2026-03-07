
-- ══════════════════════════════════════════════════════════════
-- System-wide Integrity Audit RPC + Backfill function
-- Covers: serialization bugs, export SSOT, status drift, 
--         stale step errors, tutor index completeness
-- ══════════════════════════════════════════════════════════════

-- 1. Audit RPC: returns a JSON report across ALL courses/packages
CREATE OR REPLACE FUNCTION public.run_system_integrity_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  serialization_broken int;
  serialization_details jsonb;
  done_with_error int;
  published_draft_lessons int;
  published_draft_details jsonb;
  tutor_incomplete int;
  tutor_details jsonb;
BEGIN
  -- A. Lessons with JSON-fenced or double-serialized content.html
  SELECT count(*), jsonb_agg(jsonb_build_object(
    'lesson_id', l.id,
    'module_id', l.module_id,
    'title', l.title,
    'content_preview', left(l.content::text, 200)
  )) FILTER (WHERE true)
  INTO serialization_broken, serialization_details
  FROM lessons l
  WHERE l.content IS NOT NULL
    AND l.content->>'type' = 'text'
    AND (
      -- content.html starts with ```json or { (JSON-as-string)
      l.content->>'html' LIKE '```%'
      OR (
        l.content->>'html' LIKE '{%'
        AND l.content->>'html' LIKE '%"html"%'
      )
    );

  -- B. Done steps with stale last_error
  SELECT count(*)
  INTO done_with_error
  FROM package_steps
  WHERE status = 'done'
    AND last_error IS NOT NULL;

  -- C. Published packages with draft lessons
  SELECT count(*), jsonb_agg(jsonb_build_object(
    'package_id', cp.id,
    'course_id', cp.course_id,
    'title', cp.title,
    'draft_lesson_count', sub.draft_cnt,
    'total_lesson_count', sub.total_cnt
  )) FILTER (WHERE true)
  INTO published_draft_lessons, published_draft_details
  FROM course_packages cp
  JOIN LATERAL (
    SELECT 
      count(*) AS total_cnt,
      count(*) FILTER (WHERE l.status = 'draft') AS draft_cnt
    FROM modules m
    JOIN lessons l ON l.module_id = m.id
    WHERE m.course_id = cp.course_id
  ) sub ON sub.draft_cnt > 0
  WHERE cp.status = 'published';

  -- D. Tutor indices with incomplete chunks
  SELECT count(*), jsonb_agg(jsonb_build_object(
    'package_id', idx.package_id,
    'lessons_chunks', (idx.stats->>'lessons_chunks')::int,
    'handbook_chunks', (idx.stats->>'handbook_chunks')::int,
    'topics_chunks', (idx.stats->>'topics_chunks')::int
  )) FILTER (WHERE true)
  INTO tutor_incomplete, tutor_details
  FROM ai_tutor_context_index idx
  WHERE (
    (idx.stats->>'topics_chunks')::int > 0
    AND (
      COALESCE((idx.stats->>'lessons_chunks')::int, 0) = 0
      OR COALESCE((idx.stats->>'handbook_chunks')::int, 0) = 0
    )
  );

  result := jsonb_build_object(
    'audit_ts', now(),
    'serialization_broken_lessons', serialization_broken,
    'serialization_details', COALESCE(serialization_details, '[]'::jsonb),
    'done_steps_with_stale_error', done_with_error,
    'published_packages_with_draft_lessons', published_draft_lessons,
    'published_draft_details', COALESCE(published_draft_details, '[]'::jsonb),
    'tutor_indices_incomplete', tutor_incomplete,
    'tutor_details', COALESCE(tutor_details, '[]'::jsonb),
    'verdict', CASE
      WHEN serialization_broken > 0 OR published_draft_lessons > 0 THEN 'CRITICAL'
      WHEN done_with_error > 10 OR tutor_incomplete > 0 THEN 'DEGRADED'
      ELSE 'HEALTHY'
    END
  );

  RETURN result;
END;
$$;

-- 2. Backfill function: fix double-serialized lesson content
CREATE OR REPLACE FUNCTION public.backfill_fix_serialized_lessons(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  fixed int := 0;
  skipped int := 0;
  details jsonb := '[]'::jsonb;
  inner_json jsonb;
  inner_html text;
BEGIN
  FOR rec IN
    SELECT l.id, l.content
    FROM lessons l
    WHERE l.content IS NOT NULL
      AND l.content->>'type' = 'text'
      AND (
        l.content->>'html' LIKE '```%'
        OR (
          l.content->>'html' LIKE '{%'
          AND l.content->>'html' LIKE '%"html"%'
        )
      )
  LOOP
    BEGIN
      -- Strip markdown fences and parse inner JSON
      inner_html := regexp_replace(rec.content->>'html', '^```json\s*', '');
      inner_html := regexp_replace(inner_html, '\s*```\s*$', '');
      inner_html := trim(inner_html);
      
      -- Try to parse as JSON and extract .html
      inner_json := inner_html::jsonb;
      
      IF inner_json ? 'html' THEN
        IF NOT p_dry_run THEN
          UPDATE lessons
          SET content = jsonb_set(
            rec.content::jsonb,
            '{html}',
            to_jsonb(inner_json->>'html')
          )
          WHERE id = rec.id;
        END IF;
        
        fixed := fixed + 1;
        details := details || jsonb_build_object(
          'lesson_id', rec.id,
          'action', CASE WHEN p_dry_run THEN 'would_fix' ELSE 'fixed' END,
          'original_preview', left(rec.content->>'html', 100)
        );
      ELSE
        skipped := skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      skipped := skipped + 1;
      details := details || jsonb_build_object(
        'lesson_id', rec.id,
        'action', 'parse_error',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'fixed', fixed,
    'skipped', skipped,
    'details', details
  );
END;
$$;

-- 3. Backfill function: clean stale errors on done steps
CREATE OR REPLACE FUNCTION public.backfill_clean_done_step_errors(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected int;
BEGIN
  IF p_dry_run THEN
    SELECT count(*) INTO affected
    FROM package_steps
    WHERE status = 'done' AND last_error IS NOT NULL;
    
    RETURN jsonb_build_object('dry_run', true, 'would_clean', affected);
  ELSE
    WITH cleaned AS (
      UPDATE package_steps
      SET 
        last_error = NULL,
        meta = CASE 
          WHEN last_error IS NOT NULL THEN
            jsonb_set(
              COALESCE(meta, '{}'::jsonb),
              '{previous_errors}',
              COALESCE(meta->'previous_errors', '[]'::jsonb) || 
                jsonb_build_array(format('[%s] %s', now()::text, left(last_error, 300)))
            )
          ELSE COALESCE(meta, '{}'::jsonb)
        END
      WHERE status = 'done' AND last_error IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO affected FROM cleaned;
    
    RETURN jsonb_build_object('dry_run', false, 'cleaned', affected);
  END IF;
END;
$$;
