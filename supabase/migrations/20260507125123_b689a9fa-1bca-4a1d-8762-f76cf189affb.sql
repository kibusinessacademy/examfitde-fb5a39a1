CREATE OR REPLACE FUNCTION public.fn_slugify_keyword(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(both '-' from
    regexp_replace(
      translate(
        lower(coalesce(p_text, '')),
        'äöüß',
        'aous'  -- single-char placeholders; multi-char done below
      ),
      '[^a-z0-9]+', '-', 'g'
    )
  )
$$;

-- Note: translate() is per-character. To get ä→ae/ö→oe/ü→ue/ß→ss we need replace().
CREATE OR REPLACE FUNCTION public.fn_slugify_keyword(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(both '-' from
    regexp_replace(
      replace(replace(replace(replace(replace(replace(replace(replace(
        lower(coalesce(p_text, '')),
        'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
        'Ä','ae'),'Ö','oe'),'Ü','ue'),'·','-'),
      '[^a-z0-9]+', '-', 'g'
    )
  )
$$;