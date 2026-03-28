
-- Updated timestamp helper
CREATE OR REPLACE FUNCTION public.set_updated_at_growth_tables()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_growth_content_jobs_updated_at ON public.growth_content_jobs;
CREATE TRIGGER trg_growth_content_jobs_updated_at
BEFORE UPDATE ON public.growth_content_jobs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_growth_tables();

DROP TRIGGER IF EXISTS trg_seo_content_pages_updated_at ON public.seo_content_pages;
CREATE TRIGGER trg_seo_content_pages_updated_at
BEFORE UPDATE ON public.seo_content_pages
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_growth_tables();

-- Queue social/growth jobs for one package
CREATE OR REPLACE FUNCTION public.enqueue_growth_content_jobs(
  p_package_id uuid,
  p_curriculum_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_content_types text[] := ARRAY[
    'short_video_script',
    'carousel_post',
    'social_caption',
    'faq_snippet',
    'blog_outline'
  ];
  v_audiences text[] := ARRAY['azubis', 'betriebe', 'institutionen'];
  v_platforms text[] := ARRAY['instagram', 'facebook', 'linkedin'];
  ct text;
  au text;
  pl text;
BEGIN
  FOREACH ct IN ARRAY v_content_types LOOP
    FOREACH au IN ARRAY v_audiences LOOP
      FOREACH pl IN ARRAY v_platforms LOOP
        INSERT INTO public.growth_content_jobs (
          package_id, curriculum_id, content_type, audience, platform, status
        )
        VALUES (p_package_id, p_curriculum_id, ct, au, pl, 'pending');
        v_count := v_count + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_growth_content_jobs(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_growth_content_jobs(uuid, uuid) TO authenticated, service_role;

-- Seed SEO pages for one package
CREATE OR REPLACE FUNCTION public.seed_seo_pages_for_package(
  p_package_id uuid,
  p_curriculum_id uuid,
  p_base_slug text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  INSERT INTO public.seo_content_pages (
    package_id, curriculum_id, page_type, target_audience, slug, title, status
  )
  VALUES
    (p_package_id, p_curriculum_id, 'product', null, p_base_slug, 'Produktseite', 'draft'),
    (p_package_id, p_curriculum_id, 'landing_azubis', 'azubis', p_base_slug || '-azubis', 'Landingpage Azubis', 'draft'),
    (p_package_id, p_curriculum_id, 'landing_betriebe', 'betriebe', p_base_slug || '-betriebe', 'Landingpage Betriebe', 'draft'),
    (p_package_id, p_curriculum_id, 'landing_institutionen', 'institutionen', p_base_slug || '-institutionen', 'Landingpage Institutionen', 'draft'),
    (p_package_id, p_curriculum_id, 'faq', null, p_base_slug || '-faq', 'FAQ', 'draft'),
    (p_package_id, p_curriculum_id, 'blog', null, p_base_slug || '-pruefungstipps', 'Blog', 'draft')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_seo_pages_for_package(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_seo_pages_for_package(uuid, uuid, text) TO authenticated, service_role;

-- Admin preview for growth queue
CREATE OR REPLACE FUNCTION public.get_admin_growth_content_jobs(
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, package_id uuid, curriculum_id uuid,
  content_type text, audience text, platform text,
  status text, payload jsonb, result jsonb,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gcj.id, gcj.package_id, gcj.curriculum_id,
    gcj.content_type, gcj.audience, gcj.platform,
    gcj.status, gcj.payload, gcj.result,
    gcj.created_at, gcj.updated_at
  FROM public.growth_content_jobs gcj
  WHERE p_status IS NULL OR gcj.status = p_status
  ORDER BY gcj.updated_at DESC, gcj.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_growth_content_jobs(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_growth_content_jobs(text) TO authenticated, service_role;

-- Admin SEO pages
CREATE OR REPLACE FUNCTION public.get_admin_seo_pages(
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, package_id uuid, curriculum_id uuid,
  page_type text, target_audience text, slug text,
  title text, meta_description text, content_md text,
  faq_json jsonb, status text,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.id, sp.package_id, sp.curriculum_id,
    sp.page_type, sp.target_audience, sp.slug,
    sp.title, sp.meta_description, sp.content_md,
    sp.faq_json, sp.status,
    sp.created_at, sp.updated_at
  FROM public.seo_content_pages sp
  WHERE p_status IS NULL OR sp.status = p_status
  ORDER BY sp.updated_at DESC, sp.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_seo_pages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_seo_pages(text) TO authenticated, service_role;

-- Lead capture
CREATE OR REPLACE FUNCTION public.capture_lead(
  p_email text,
  p_curriculum_id uuid,
  p_source text,
  p_intent text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.leads (email, curriculum_id, source, intent)
  VALUES (lower(trim(p_email)), p_curriculum_id, p_source, p_intent)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_lead(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_lead(text, uuid, text, text) TO anon, authenticated, service_role;
