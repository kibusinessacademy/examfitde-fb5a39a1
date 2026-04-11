
-- 1. Unique constraint on slug
ALTER TABLE public.cms_pages ADD CONSTRAINT cms_pages_slug_unique UNIQUE (slug);

-- 2. Trigger: update cms_pages.updated_at when blocks change
CREATE OR REPLACE FUNCTION public.touch_cms_page_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.cms_pages SET updated_at = now()
  WHERE id = COALESCE(NEW.page_id, OLD.page_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_cms_blocks_touch_page
AFTER INSERT OR UPDATE OR DELETE ON public.cms_page_blocks
FOR EACH ROW
EXECUTE FUNCTION public.touch_cms_page_updated_at();

-- 3. Snapshot function for versioning
CREATE OR REPLACE FUNCTION public.snapshot_page_version(p_page_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS uuid AS $$
DECLARE
  v_version_number int;
  v_snapshot jsonb;
  v_id uuid;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_version_number
  FROM public.cms_page_versions
  WHERE page_id = p_page_id;

  SELECT jsonb_build_object(
    'page', row_to_json(p.*),
    'blocks', COALESCE((
      SELECT jsonb_agg(row_to_json(b.*) ORDER BY b.sort_order)
      FROM public.cms_page_blocks b
      WHERE b.page_id = p_page_id
    ), '[]'::jsonb)
  )
  INTO v_snapshot
  FROM public.cms_pages p
  WHERE p.id = p_page_id;

  INSERT INTO public.cms_page_versions (page_id, version_number, snapshot_json, created_by)
  VALUES (p_page_id, v_version_number, v_snapshot, p_created_by)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 4. Auto-snapshot on publish
CREATE OR REPLACE FUNCTION public.auto_snapshot_on_publish()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    PERFORM public.snapshot_page_version(NEW.id, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_cms_page_auto_snapshot
BEFORE UPDATE ON public.cms_pages
FOR EACH ROW
EXECUTE FUNCTION public.auto_snapshot_on_publish();
