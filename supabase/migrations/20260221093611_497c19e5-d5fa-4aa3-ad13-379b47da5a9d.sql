
-- =============================================
-- ExamFit Taxonomy System: Categories, Subcategories, Tags
-- =============================================

-- 1. Extend enums
ALTER TYPE certification_type ADD VALUE IF NOT EXISTS 'aufstiegsfortbildung';
ALTER TYPE certification_type ADD VALUE IF NOT EXISTS 'sonstige';
ALTER TYPE product_track ADD VALUE IF NOT EXISTS 'FORTBILDUNG';
ALTER TYPE product_track ADD VALUE IF NOT EXISTS 'ZERTIFIKAT';

-- 2. Product Categories (Top-Level)
CREATE TABLE public.product_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  seo_path TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_categories_public_read" ON public.product_categories FOR SELECT USING (true);

-- 3. Product Subcategories
CREATE TABLE public.product_subcategories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.product_categories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  seo_path TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, slug)
);

ALTER TABLE public.product_subcategories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_subcategories_public_read" ON public.product_subcategories FOR SELECT USING (true);

-- 4. Tag Groups
CREATE TABLE public.tag_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tag_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tag_groups_public_read" ON public.tag_groups FOR SELECT USING (true);

-- 5. Product Tags
CREATE TABLE public.product_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.tag_groups(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, slug)
);

ALTER TABLE public.product_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_tags_public_read" ON public.product_tags FOR SELECT USING (true);

-- 6. Package-Tags Junction
CREATE TABLE public.package_tags (
  package_id UUID NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.product_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, tag_id)
);

ALTER TABLE public.package_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "package_tags_public_read" ON public.package_tags FOR SELECT USING (true);

-- 7. Add structured columns to course_packages
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.product_categories(id),
  ADD COLUMN IF NOT EXISTS subcategory_id UUID REFERENCES public.product_subcategories(id),
  ADD COLUMN IF NOT EXISTS chamber_type TEXT,
  ADD COLUMN IF NOT EXISTS exam_structure TEXT;

-- 8. Indexes
CREATE INDEX idx_course_packages_category ON public.course_packages(category_id);
CREATE INDEX idx_course_packages_subcategory ON public.course_packages(subcategory_id);
CREATE INDEX idx_course_packages_chamber ON public.course_packages(chamber_type);
CREATE INDEX idx_package_tags_tag ON public.package_tags(tag_id);
CREATE INDEX idx_product_subcategories_category ON public.product_subcategories(category_id);
CREATE INDEX idx_product_tags_group ON public.product_tags(group_id);
