
-- ═══════════════════════════════════════════════════════════════
-- Production Wave System — Mass Course Factory Backbone
-- ═══════════════════════════════════════════════════════════════

-- Wave status enum
CREATE TYPE public.wave_status AS ENUM (
  'draft',
  'seeding',
  'active',
  'paused',
  'completed',
  'cancelled'
);

-- Wave item status enum
CREATE TYPE public.wave_item_status AS ENUM (
  'pending',
  'queued',
  'building',
  'quality_gate_passed',
  'quality_gate_failed',
  'published',
  'blocked',
  'skipped'
);

-- ─── production_waves ───
CREATE TABLE public.production_waves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status wave_status NOT NULL DEFAULT 'draft',
  track TEXT DEFAULT 'AUSBILDUNG_VOLL',
  priority_min INTEGER DEFAULT 1,
  priority_max INTEGER DEFAULT 10,
  target_count INTEGER NOT NULL DEFAULT 0,
  seeded_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  max_concurrent INTEGER NOT NULL DEFAULT 8,
  created_by TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── production_wave_items ───
CREATE TABLE public.production_wave_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id UUID NOT NULL REFERENCES public.production_waves(id) ON DELETE CASCADE,
  curriculum_id UUID NOT NULL,
  course_id UUID,
  package_id UUID,
  status wave_item_status NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 5,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  quality_score NUMERIC,
  publish_blocked_reason TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(wave_id, curriculum_id)
);

-- Indexes for performance
CREATE INDEX idx_wave_items_wave_status ON public.production_wave_items(wave_id, status);
CREATE INDEX idx_wave_items_package ON public.production_wave_items(package_id) WHERE package_id IS NOT NULL;
CREATE INDEX idx_waves_status ON public.production_waves(status);

-- RLS
ALTER TABLE public.production_waves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_wave_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on production_waves"
  ON public.production_waves FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read production_waves"
  ON public.production_waves FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role full access on production_wave_items"
  ON public.production_wave_items FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read production_wave_items"
  ON public.production_wave_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ─── Auto-update updated_at ───
CREATE OR REPLACE FUNCTION public.trg_update_wave_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_production_waves_updated
  BEFORE UPDATE ON public.production_waves
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_wave_timestamps();

CREATE TRIGGER trg_production_wave_items_updated
  BEFORE UPDATE ON public.production_wave_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_wave_timestamps();

-- ─── Wave summary RPC ───
CREATE OR REPLACE FUNCTION public.get_wave_summary(p_wave_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'wave_id', w.id,
    'name', w.name,
    'status', w.status,
    'target_count', w.target_count,
    'items', jsonb_build_object(
      'pending', count(*) FILTER (WHERE wi.status = 'pending'),
      'queued', count(*) FILTER (WHERE wi.status = 'queued'),
      'building', count(*) FILTER (WHERE wi.status = 'building'),
      'quality_gate_passed', count(*) FILTER (WHERE wi.status = 'quality_gate_passed'),
      'quality_gate_failed', count(*) FILTER (WHERE wi.status = 'quality_gate_failed'),
      'published', count(*) FILTER (WHERE wi.status = 'published'),
      'blocked', count(*) FILTER (WHERE wi.status = 'blocked'),
      'skipped', count(*) FILTER (WHERE wi.status = 'skipped'),
      'total', count(*)
    ),
    'started_at', w.started_at,
    'finished_at', w.finished_at,
    'duration_minutes', EXTRACT(EPOCH FROM (COALESCE(w.finished_at, now()) - w.started_at)) / 60
  )
  INTO v_result
  FROM production_waves w
  LEFT JOIN production_wave_items wi ON wi.wave_id = w.id
  WHERE w.id = p_wave_id
  GROUP BY w.id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_wave_summary TO service_role;
