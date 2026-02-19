
-- Fix: cast enum to text
CREATE OR REPLACE FUNCTION public.populate_admin_search_index()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM admin_search_index;
  
  INSERT INTO admin_search_index (entity_type, entity_id, title, subtitle, url, keywords)
  SELECT 'package', id, title, status::text,
    '/admin/studio/' || id,
    to_tsvector('german', COALESCE(title,'') || ' ' || COALESCE(status::text,'') || ' ' || COALESCE(certification_type::text,'unknown'))
  FROM course_packages
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, keywords = EXCLUDED.keywords, updated_at = now();

  INSERT INTO admin_search_index (entity_type, entity_id, title, subtitle, url, keywords)
  SELECT 'page', id, title, page_type || ' · ' || status, '/admin/content',
    to_tsvector('german', COALESCE(title,'') || ' ' || COALESCE(slug,'') || ' ' || COALESCE(meta_title,''))
  FROM content_pages
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, keywords = EXCLUDED.keywords, updated_at = now();

  INSERT INTO admin_search_index (entity_type, entity_id, title, subtitle, url, keywords)
  SELECT 'blog', id, title, COALESCE(category,'Blog') || ' · ' || status, '/admin/content/blog',
    to_tsvector('german', COALESCE(title,'') || ' ' || COALESCE(slug,'') || ' ' || COALESCE(excerpt,''))
  FROM blog_posts
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, keywords = EXCLUDED.keywords, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_update_search_index()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'course_packages' THEN
    INSERT INTO admin_search_index (entity_type, entity_id, title, subtitle, url, keywords)
    VALUES ('package', NEW.id, NEW.title, NEW.status::text,
      '/admin/studio/' || NEW.id,
      to_tsvector('german', COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.status::text,'') || ' ' || COALESCE(NEW.certification_type::text,'unknown')))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, keywords = EXCLUDED.keywords, updated_at = now();
  ELSIF TG_TABLE_NAME = 'content_pages' THEN
    INSERT INTO admin_search_index (entity_type, entity_id, title, subtitle, url, keywords)
    VALUES ('page', NEW.id, NEW.title, NEW.page_type || ' · ' || NEW.status, '/admin/content',
      to_tsvector('german', COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.slug,'') || ' ' || COALESCE(NEW.meta_title,'')))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, keywords = EXCLUDED.keywords, updated_at = now();
  ELSIF TG_TABLE_NAME = 'blog_posts' THEN
    INSERT INTO admin_search_index (entity_type, entity_id, title, subtitle, url, keywords)
    VALUES ('blog', NEW.id, NEW.title, COALESCE(NEW.category,'Blog') || ' · ' || NEW.status, '/admin/content/blog',
      to_tsvector('german', COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.slug,'') || ' ' || COALESCE(NEW.excerpt,'')))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, keywords = EXCLUDED.keywords, updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_search_index_packages ON public.course_packages;
CREATE TRIGGER trg_search_index_packages AFTER INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_search_index();
DROP TRIGGER IF EXISTS trg_search_index_content_pages ON public.content_pages;
CREATE TRIGGER trg_search_index_content_pages AFTER INSERT OR UPDATE ON public.content_pages
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_search_index();
DROP TRIGGER IF EXISTS trg_search_index_blog ON public.blog_posts;
CREATE TRIGGER trg_search_index_blog AFTER INSERT OR UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_search_index();

SELECT public.populate_admin_search_index();
