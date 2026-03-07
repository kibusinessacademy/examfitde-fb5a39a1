
-- V3: Handle truncated JSON by extracting html value via string manipulation
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
  extracted_html text;
  start_pos int;
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
      
      -- Strategy: find "html": " marker and extract the HTML value
      -- The pattern is: ```json\n{\n  "html": "<actual HTML here>", "objectives":...
      start_pos := position('"html": "' in raw_html);
      IF start_pos = 0 THEN
        -- Try alternate spacing
        start_pos := position('"html":"' in raw_html);
        IF start_pos > 0 THEN
          start_pos := start_pos + 8; -- length of '"html":"'
        END IF;
      ELSE
        start_pos := start_pos + 9; -- length of '"html": "'
      END IF;
      
      IF start_pos > 0 THEN
        -- Find the closing quote: look for ", " or ""\n or just the end
        -- The html value is a JSON-escaped string, so we need to find unescaped "
        -- Simplified: find '", "' or '",\n' pattern that ends the html value
        DECLARE
          remaining text;
          end_markers text[] := ARRAY['", "objectives"', '", "key_terms"', '", "common_mistakes"', '",\n', '"\n}'];
          marker text;
          end_pos int;
          best_end int := 0;
        BEGIN
          remaining := substring(raw_html from start_pos);
          
          -- Find the earliest valid end marker
          FOREACH marker IN ARRAY end_markers LOOP
            end_pos := position(marker in remaining);
            IF end_pos > 0 AND (best_end = 0 OR end_pos < best_end) THEN
              best_end := end_pos;
            END IF;
          END LOOP;
          
          IF best_end > 0 THEN
            extracted_html := substring(remaining from 1 for best_end - 1);
          ELSE
            -- No end marker found (truncated JSON) — take everything after "html": "
            -- but strip trailing incomplete JSON artifacts
            extracted_html := remaining;
            -- Remove trailing partial JSON
            extracted_html := regexp_replace(extracted_html, '",?\s*"[a-z_]+"\s*:\s*(\[|\{).*$', '', 'i');
            -- Remove trailing quote if present
            extracted_html := regexp_replace(extracted_html, '"\s*$', '');
          END IF;
          
          -- Unescape JSON string escapes
          extracted_html := replace(extracted_html, '\"', '"');
          extracted_html := replace(extracted_html, '\\n', E'\n');
          extracted_html := replace(extracted_html, '\\t', E'\t');
          extracted_html := replace(extracted_html, '\\\\', '\');
          
          -- Validate: must contain HTML tags
          IF extracted_html IS NOT NULL AND length(extracted_html) > 100 
             AND (extracted_html LIKE '%<%' AND extracted_html LIKE '%>%') THEN
            
            new_content := rec.content::jsonb;
            new_content := jsonb_set(new_content, '{html}', to_jsonb(extracted_html));
            new_content := jsonb_set(new_content, '{_backfill_fixed}', 'true'::jsonb);
            new_content := jsonb_set(new_content, '{_backfill_at}', to_jsonb(now()::text));
            
            IF NOT p_dry_run THEN
              UPDATE lessons SET content = new_content WHERE id = rec.id;
            END IF;
            
            fixed := fixed + 1;
          ELSE
            skipped := skipped + 1;
          END IF;
        END;
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
