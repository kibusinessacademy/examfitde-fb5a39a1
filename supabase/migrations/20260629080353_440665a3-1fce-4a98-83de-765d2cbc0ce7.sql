CREATE TABLE IF NOT EXISTS public.seo_beruf_backlink_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beruf_id uuid REFERENCES public.berufe(id) ON DELETE CASCADE,
  beruf_slug text,
  target_url text NOT NULL,
  target_label text,
  anchor_hint text,
  priority int NOT NULL DEFAULT 50,
  max_links_per_doc int NOT NULL DEFAULT 1,
  link_type text NOT NULL DEFAULT 'cluster_to_pillar',
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT seo_beruf_backlink_rules_beruf_target_uk
    UNIQUE (beruf_id, target_url, link_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_beruf_backlink_rules TO authenticated;
GRANT ALL ON public.seo_beruf_backlink_rules TO service_role;

ALTER TABLE public.seo_beruf_backlink_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage backlink rules" ON public.seo_beruf_backlink_rules;
CREATE POLICY "Admins manage backlink rules"
  ON public.seo_beruf_backlink_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_seo_beruf_backlink_rules_beruf_active
  ON public.seo_beruf_backlink_rules(beruf_id, is_active, priority);

CREATE OR REPLACE FUNCTION public.tg_touch_seo_beruf_backlink_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_touch_seo_beruf_backlink_rules ON public.seo_beruf_backlink_rules;
CREATE TRIGGER trg_touch_seo_beruf_backlink_rules
  BEFORE UPDATE ON public.seo_beruf_backlink_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_seo_beruf_backlink_rules();