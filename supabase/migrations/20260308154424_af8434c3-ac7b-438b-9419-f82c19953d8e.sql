
-- Improve normalize_qualification_title: better gender-insensitive normalization
CREATE OR REPLACE FUNCTION public.normalize_qualification_title(p_title text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v text := lower(trim(p_title));
BEGIN
  -- Collapse whitespace
  v := regexp_replace(v, '\s+', ' ', 'g');

  -- Convert German umlauts/ligatures BEFORE stripping
  v := replace(v, 'ä', 'ae');
  v := replace(v, 'ö', 'oe');
  v := replace(v, 'ü', 'ue');
  v := replace(v, 'ß', 'ss');

  -- Remove common qualifiers
  v := replace(v, 'ihk', '');
  v := replace(v, 'hwk', '');
  v := replace(v, 'master professional in business management', '');
  v := replace(v, 'bachelor professional', '');

  -- Remove gender suffixes: /-in, /-r, /-e, /-er, (m/w/d), -frau variants
  v := regexp_replace(v, '/-(?:in|r|e|er|erin|frau)\b', '', 'g');
  v := regexp_replace(v, '\s*\(m/w/d\)', '', 'g');

  -- Normalize gendered word endings to masculine base form:
  -- "medizinische" -> "medizinisch", "fachangestellte" -> "fachangestellter"
  -- Strip trailing -e/-er/-in/-erin on occupation words (careful: only after consonant clusters typical for German occupations)
  v := regexp_replace(v, '\bmedizinisch(?:e|er|es)\b', 'medizinisch', 'g');
  v := regexp_replace(v, '\bfachangestellte(?:r)?\b', 'fachangestellter', 'g');
  v := regexp_replace(v, '\bkauffrau\b', 'kaufmann', 'g');

  -- Remove "rahmenlehrplan" prefix
  v := regexp_replace(v, '^rahmenlehrplan\s+', '', 'g');

  v := trim(v);

  -- Special canonical forms
  IF v LIKE '%betriebswirt%' THEN RETURN 'gepruefter betriebswirt'; END IF;
  IF v LIKE '%wirtschaftsfachwirt%' THEN RETURN 'gepruefter wirtschaftsfachwirt'; END IF;
  IF v LIKE '%technischer fachwirt%' THEN RETURN 'gepruefter technischer fachwirt'; END IF;
  IF v LIKE '%bilanzbuchhalter%' THEN RETURN 'gepruefter bilanzbuchhalter'; END IF;
  IF v LIKE '%controller%' THEN RETURN 'gepruefter controller'; END IF;
  IF v LIKE '%fachmann%kaufm%betriebsf%' THEN RETURN 'gepruefter fachmann fuer kaufmaennische betriebsfuehrung'; END IF;
  IF v LIKE '%meister%' THEN RETURN 'meister'; END IF;
  IF v LIKE '%fachwirt%' THEN RETURN regexp_replace(v, '[^a-z0-9 ]', '', 'g'); END IF;
  IF v LIKE '%fachkaufmann%' OR v LIKE '%fachkauffrau%' THEN RETURN regexp_replace(v, '[^a-z0-9 ]', '', 'g'); END IF;

  -- Final cleanup: strip remaining non-alphanumeric
  RETURN regexp_replace(v, '[^a-z0-9 ]', '', 'g');
END;
$$;
