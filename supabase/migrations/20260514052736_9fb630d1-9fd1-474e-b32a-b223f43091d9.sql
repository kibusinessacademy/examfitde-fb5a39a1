-- Slice 2 Blocker-Fix: fn_normalize_curriculum_slug
-- Rollback-Hint: vorherige Definition stripte tokens (examfit|prüfung|ihk|...) und
--                ließ Spaces stehen ("aevo - ausbildereignungs"). Restore via git history.

CREATE OR REPLACE FUNCTION public.fn_normalize_curriculum_slug(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    -- 5) trim leading/trailing dashes
    trim(both '-' from
      -- 4) collapse multi-dashes
      regexp_replace(
        -- 3) replace any non-[a-z0-9] with single dash
        regexp_replace(
          -- 2) lowercase + umlaut transliteration
          translate(
            lower(coalesce(p_title,'')),
            'äöüßéèêàâçñ',
            'aouseeeaacn'
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      )
    );
$function$;

-- Note: simple translate() can't expand ä→ae (1:2). Apply explicit pre-pass for umlauts:
CREATE OR REPLACE FUNCTION public.fn_normalize_curriculum_slug(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    trim(both '-' from
      regexp_replace(
        regexp_replace(
          replace(replace(replace(replace(replace(replace(replace(replace(
            lower(coalesce(p_title,'')),
            'ä','ae'),
            'ö','oe'),
            'ü','ue'),
            'ß','ss'),
            'é','e'),
            'è','e'),
            'â','a'),
            'à','a'),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      )
    );
$function$;

-- Smoke regression
DO $$
DECLARE
  r record;
  cases text[][] := ARRAY[
    ARRAY['AEVO - Ausbildereignungsprüfung','aevo-ausbildereignungspruefung'],
    ARRAY['Geprüfter Betriebswirt IHK','gepruefter-betriebswirt-ihk'],
    ARRAY['Fachinformatiker Anwendungsentwicklung','fachinformatiker-anwendungsentwicklung'],
    ARRAY['  Scrum Master (PSM I) ','scrum-master-psm-i'],
    ARRAY['Bilanzbuchhalter/-in','bilanzbuchhalter-in']
  ];
  c text[];
  got text;
  failed int := 0;
BEGIN
  FOREACH c SLICE 1 IN ARRAY cases LOOP
    got := public.fn_normalize_curriculum_slug(c[1]);
    IF got IS DISTINCT FROM c[2] THEN
      RAISE WARNING 'SLUG MISMATCH input=% expected=% got=%', c[1], c[2], got;
      failed := failed + 1;
    END IF;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION 'fn_normalize_curriculum_slug smoke failed: % case(s)', failed;
  END IF;
END $$;

-- Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'seo_intent_slug_normalizer_fixed',
  'system',
  'success',
  jsonb_build_object(
    'function','public.fn_normalize_curriculum_slug',
    'change','kebab-case + umlaut transliteration; removed token-stripping',
    'callers', ARRAY['fn_seo_build_ssot_skeleton','fn_guard_curriculum_dedup']
  )
);