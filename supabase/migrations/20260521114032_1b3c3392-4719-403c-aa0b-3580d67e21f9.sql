
CREATE OR REPLACE FUNCTION public.fn_path_in_sitemap(_path text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p text := COALESCE(_path, '');
  v_slug text;
BEGIN
  IF p = '' OR p = '/' THEN RETURN TRUE; END IF;

  IF p LIKE '/paket/%' THEN
    v_slug := split_part(trim(both '/' from substring(p from 8)), '/', 1);
    RETURN EXISTS (SELECT 1 FROM public.v_paket_sitemap_entries e WHERE e.bezeichnung_kurz = v_slug);
  END IF;

  IF p LIKE '/blog/%' THEN
    v_slug := split_part(trim(both '/' from substring(p from 7)), '/', 1);
    RETURN EXISTS (SELECT 1 FROM public.v_blog_sitemap_entries e WHERE e.slug = v_slug);
  END IF;

  IF p LIKE '/wissen/%' THEN
    RETURN EXISTS (SELECT 1 FROM public.v_wissen_sitemap_entries v WHERE v.path = p);
  END IF;

  IF p LIKE '/pruefungstraining/%' THEN
    v_slug := split_part(trim(both '/' from substring(p from 19)), '/', 1);
    RETURN EXISTS (SELECT 1 FROM public.v_pruefungstraining_sitemap_entries e WHERE e.slug = v_slug);
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.route_crawl_policy
    WHERE match_type='exact' AND state='index' AND pattern = p
  );
END $$;
