
-- ═══════════════════════════════════════════════════════════
-- ExamFit Versioning Framework v2 (fix: nullable certification_id)
-- ═══════════════════════════════════════════════════════════

-- 1. Products table
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NULL,
  slug text NOT NULL UNIQUE,
  active_package_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_certification_idx ON public.products(certification_id);
CREATE INDEX IF NOT EXISTS products_active_package_idx ON public.products(active_package_id);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists then recreate
DROP POLICY IF EXISTS "Service role full access on products" ON public.products;
CREATE POLICY "Service role full access on products"
  ON public.products FOR ALL
  USING (true) WITH CHECK (true);

-- 2. Extend course_packages (columns may already exist from failed attempt)
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS product_id uuid NULL REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS course_packages_product_idx ON public.course_packages(product_id);
CREATE INDEX IF NOT EXISTS course_packages_published_idx ON public.course_packages(is_published) WHERE is_published = true;

-- Unique version per product
DROP INDEX IF EXISTS course_packages_unique_version;
CREATE UNIQUE INDEX course_packages_unique_version
  ON public.course_packages(product_id, version)
  WHERE product_id IS NOT NULL;

-- 3. Backfill existing published packages
DO $$
DECLARE
  pkg RECORD;
  new_product_id uuid;
  slug_val text;
BEGIN
  FOR pkg IN
    SELECT id, certification_id, title
    FROM public.course_packages
    WHERE status = 'published'
      AND product_id IS NULL
  LOOP
    slug_val := lower(regexp_replace(coalesce(pkg.title, ''), '[^a-zA-Z0-9äöüß]+', '-', 'g'));
    slug_val := trim(both '-' from slug_val);
    IF slug_val = '' OR slug_val IS NULL THEN
      slug_val := 'product-' || substr(pkg.id::text, 1, 8);
    END IF;
    slug_val := slug_val || '-' || substr(pkg.id::text, 1, 8);

    INSERT INTO public.products (certification_id, slug)
    VALUES (pkg.certification_id, slug_val)
    RETURNING id INTO new_product_id;

    UPDATE public.course_packages
    SET product_id = new_product_id,
        version = 1,
        is_published = true
    WHERE id = pkg.id;

    UPDATE public.products
    SET active_package_id = pkg.id
    WHERE id = new_product_id;
  END LOOP;
END;
$$;

-- 4. Atomic Publish Switch RPC
CREATE OR REPLACE FUNCTION public.publish_package_version(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_old_package_id uuid;
  v_version integer;
BEGIN
  SELECT product_id, version INTO v_product_id, v_version
  FROM public.course_packages
  WHERE id = p_package_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Package % has no product_id', p_package_id;
  END IF;

  SELECT active_package_id INTO v_old_package_id
  FROM public.products WHERE id = v_product_id;

  IF v_old_package_id IS NOT NULL AND v_old_package_id != p_package_id THEN
    UPDATE public.course_packages
    SET is_published = false
    WHERE id = v_old_package_id;
  END IF;

  UPDATE public.course_packages
  SET is_published = true,
      status = 'published',
      published_at = now(),
      build_progress = 100,
      council_approved = true,
      updated_at = now()
  WHERE id = p_package_id;

  UPDATE public.products
  SET active_package_id = p_package_id, updated_at = now()
  WHERE id = v_product_id;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product_id,
    'old_package_id', v_old_package_id,
    'new_package_id', p_package_id,
    'version', v_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_package_version FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_package_version TO service_role;

-- 5. Rollback RPC
CREATE OR REPLACE FUNCTION public.rollback_package_version(
  p_product_id uuid,
  p_target_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_id uuid;
  v_target_status text;
BEGIN
  SELECT status INTO v_target_status
  FROM public.course_packages
  WHERE id = p_target_package_id AND product_id = p_product_id;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'Target package not found for this product';
  END IF;

  SELECT active_package_id INTO v_current_id
  FROM public.products WHERE id = p_product_id;

  IF v_current_id IS NOT NULL THEN
    UPDATE public.course_packages SET is_published = false WHERE id = v_current_id;
  END IF;

  UPDATE public.course_packages
  SET is_published = true, status = 'published'
  WHERE id = p_target_package_id;

  UPDATE public.products
  SET active_package_id = p_target_package_id, updated_at = now()
  WHERE id = p_product_id;

  RETURN jsonb_build_object('ok', true, 'rolled_back_to', p_target_package_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_package_version FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_package_version TO service_role;

-- 6. Immutable guard trigger
CREATE OR REPLACE FUNCTION public.guard_published_package_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_published = true THEN
    -- Allow: deactivation, archiving, status changes during publish flow
    IF NEW.is_published = false OR NEW.archived != OLD.archived OR NEW.status != OLD.status THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Published packages are immutable (package_id=%)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_published_immutable ON public.course_packages;
CREATE TRIGGER trg_guard_published_immutable
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_published_package_immutable();
