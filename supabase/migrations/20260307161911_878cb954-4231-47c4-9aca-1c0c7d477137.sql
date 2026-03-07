
-- Fix backfill function to handle ```json fences with newlines properly
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
  errors int := 0;
  raw_html text;
  stripped text;
  inner_json jsonb;
  new_content jsonb;
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
      raw_html := rec.content->>'html';
      
      -- Strip ```json ... ``` fences (with newlines)
      stripped := regexp_replace(raw_html, '^\s*```json?\s*', '', 'i');
      stripped := regexp_replace(stripped, '\s*```\s*$', '', 'i');
      stripped := trim(stripped);
      
      -- Also handle trailing ``` that might appear mid-text
      IF stripped LIKE '%```' THEN
        stripped := regexp_replace(stripped, '\s*```\s*$', '');
      END IF;
      
      -- Try parse as JSON
      BEGIN
        inner_json := stripped::jsonb;
      EXCEPTION WHEN OTHERS THEN
        -- Maybe double-escaped JSON, try to find first { to last }
        DECLARE
          first_brace int;
          last_brace int;
        BEGIN
          first_brace := position('{' in stripped);
          last_brace := length(stripped) - position('}' in reverse(stripped)) + 1;
          IF first_brace > 0 AND last_brace > first_brace THEN
            inner_json := substring(stripped from first_brace for last_brace - first_brace + 1)::jsonb;
          ELSE
            errors := errors + 1;
            CONTINUE;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          errors := errors + 1;
          CONTINUE;
        END;
      END;
      
      -- Extract the inner html field
      IF inner_json ? 'html' AND (inner_json->>'html') IS NOT NULL THEN
        -- Build new content: replace html with the unwrapped value, keep other fields
        new_content := rec.content::jsonb;
        new_content := jsonb_set(new_content, '{html}', to_jsonb(inner_json->>'html'));
        
        -- Also merge objectives/key_terms if missing in outer but present in inner
        IF NOT (new_content ? 'objectives') AND (inner_json ? 'objectives') THEN
          new_content := jsonb_set(new_content, '{objectives}', inner_json->'objectives');
        END IF;
        IF NOT (new_content ? 'key_terms') AND (inner_json ? 'key_terms') THEN
          new_content := jsonb_set(new_content, '{key_terms}', inner_json->'key_terms');
        END IF;
        
        -- Tag as backfilled
        new_content := jsonb_set(new_content, '{_backfill_fixed}', 'true'::jsonb);
        new_content := jsonb_set(new_content, '{_backfill_at}', to_jsonb(now()::text));
        
        IF NOT p_dry_run THEN
          UPDATE lessons SET content = new_content WHERE id = rec.id;
        END IF;
        
        fixed := fixed + 1;
      ELSE
        skipped := skipped + 1;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      errors := errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'fixed', fixed,
    'skipped', skipped,
    'errors', errors,
    'total_processed', fixed + skipped + errors
  );
END;
$$;
