-- =============================================================================
-- Produkt-Curriculum-Verknüpfung: curriculum_products Tabelle
-- Ermöglicht: Ein Curriculum → mehrere Produkte (learning_course, exam_trainer, bundle)
-- =============================================================================

-- 1. Neue Junction-Tabelle für Curriculum ↔ Store-Produkt Verknüpfung
CREATE TABLE public.curriculum_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  
  -- Verknüpfte Inhalte
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,  -- Lernkurs (wenn learning_course)
  blueprint_id UUID REFERENCES public.exam_blueprints(id) ON DELETE SET NULL,  -- Prüfungstrainer
  
  -- Generierungs-Status
  generation_status TEXT NOT NULL DEFAULT 'pending' CHECK (generation_status IN ('pending', 'generating', 'ready', 'error')),
  generation_error TEXT,
  generated_at TIMESTAMP WITH TIME ZONE,
  
  -- SEO & Publishing
  slug TEXT,
  seo_title TEXT,
  seo_description TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  -- Unique constraint: Ein Produkt pro Curriculum
  UNIQUE(curriculum_id, product_id)
);

-- 2. Qualitäts-Checks Tabelle
CREATE TABLE public.quality_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_product_id UUID NOT NULL REFERENCES public.curriculum_products(id) ON DELETE CASCADE,
  
  -- Check-Typen
  check_type TEXT NOT NULL CHECK (check_type IN ('coverage', 'duplicate', 'correctness', 'difficulty_distribution')),
  
  -- Ergebnisse
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'passed', 'failed', 'warning')),
  score NUMERIC,  -- 0-100
  details JSONB,  -- Detaillierte Ergebnisse
  
  -- Ausführung
  executed_at TIMESTAMP WITH TIME ZONE,
  executed_by UUID REFERENCES auth.users(id),
  
  -- Admin-Review
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES auth.users(id),
  review_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. Indexes für Performance
CREATE INDEX idx_curriculum_products_curriculum ON public.curriculum_products(curriculum_id);
CREATE INDEX idx_curriculum_products_product ON public.curriculum_products(product_id);
CREATE INDEX idx_curriculum_products_status ON public.curriculum_products(generation_status);
CREATE INDEX idx_curriculum_products_published ON public.curriculum_products(is_published) WHERE is_published = true;
CREATE INDEX idx_quality_checks_cp ON public.quality_checks(curriculum_product_id);
CREATE INDEX idx_quality_checks_status ON public.quality_checks(status);

-- 4. RLS aktivieren
ALTER TABLE public.curriculum_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_checks ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies für curriculum_products (using existing has_role function)
-- Admins können alles
CREATE POLICY "Admins can manage curriculum_products" 
ON public.curriculum_products 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Veröffentlichte Produkte sind für alle sichtbar
CREATE POLICY "Published curriculum_products are viewable" 
ON public.curriculum_products 
FOR SELECT 
USING (is_published = true);

-- 6. RLS Policies für quality_checks (nur Admins)
CREATE POLICY "Admins can manage quality_checks" 
ON public.quality_checks 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- 7. Trigger für updated_at
CREATE TRIGGER update_curriculum_products_updated_at
BEFORE UPDATE ON public.curriculum_products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_quality_checks_updated_at
BEFORE UPDATE ON public.quality_checks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Hilfsfunktion: Automatische Quality-Check Einträge erstellen
CREATE OR REPLACE FUNCTION public.create_quality_checks_for_product()
RETURNS TRIGGER AS $$
BEGIN
  -- Erstelle alle Check-Typen für neues curriculum_product
  INSERT INTO public.quality_checks (curriculum_product_id, check_type)
  VALUES 
    (NEW.id, 'coverage'),
    (NEW.id, 'duplicate'),
    (NEW.id, 'correctness'),
    (NEW.id, 'difficulty_distribution');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER create_quality_checks_trigger
AFTER INSERT ON public.curriculum_products
FOR EACH ROW
EXECUTE FUNCTION public.create_quality_checks_for_product();

-- 9. View für Admin-Dashboard: Curriculum-Produkt-Übersicht mit Quality-Status
CREATE OR REPLACE VIEW public.curriculum_products_overview AS
SELECT 
  cp.*,
  c.title AS curriculum_title,
  c.status AS curriculum_status,
  sp.name AS product_name,
  sp.product_key,
  co.title AS course_title,
  eb.title AS blueprint_title,
  -- Aggregierte Quality-Check-Statistik
  (
    SELECT jsonb_object_agg(qc.check_type, qc.status)
    FROM public.quality_checks qc
    WHERE qc.curriculum_product_id = cp.id
  ) AS quality_status
FROM public.curriculum_products cp
JOIN public.curricula c ON c.id = cp.curriculum_id
JOIN public.store_products sp ON sp.id = cp.product_id
LEFT JOIN public.courses co ON co.id = cp.course_id
LEFT JOIN public.exam_blueprints eb ON eb.id = cp.blueprint_id;

-- Grant access to the view
GRANT SELECT ON public.curriculum_products_overview TO authenticated;