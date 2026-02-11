
-- Council 5: Tutor Council – tutor_assets + Publish Gate + RLS

CREATE TABLE IF NOT EXISTS public.tutor_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL CHECK (asset_type IN ('tutor_template','oral_exam_prompt','oral_exam_rubric','feedback_template')),
  scope_type text NOT NULL CHECK (scope_type IN ('competency','lesson','exam_session','course','global')),
  scope_id uuid NULL,
  locale text NOT NULL DEFAULT 'de-DE',
  title text NOT NULL,
  published_version_id uuid NULL,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_assets_scope ON public.tutor_assets(scope_type, scope_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_tutor_assets_published ON public.tutor_assets(is_published, asset_type);

-- Publish RPC
CREATE OR REPLACE FUNCTION public.publish_tutor_asset(
  p_asset_id uuid, p_version_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status public.content_version_status;
  v_decision public.council_decision;
BEGIN
  SELECT status INTO v_status FROM public.content_versions WHERE id = p_version_id;
  SELECT final_decision INTO v_decision FROM public.council_verdicts WHERE content_version_id = p_version_id;
  IF v_status <> 'approved' OR v_decision <> 'approved' THEN
    RAISE EXCEPTION 'Tutor publish blocked: version not approved (status=% verdict=%)', v_status, v_decision;
  END IF;
  UPDATE public.tutor_assets SET published_version_id = p_version_id, is_published = true, updated_at = now() WHERE id = p_asset_id;
END $$;

-- Guard trigger
CREATE OR REPLACE FUNCTION public.guard_publish_tutor_assets() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status public.content_version_status;
  v_decision public.council_decision;
BEGIN
  IF NEW.is_published = true AND (OLD.is_published IS DISTINCT FROM true) THEN
    IF NEW.published_version_id IS NULL THEN RAISE EXCEPTION 'Publish blocked: published_version_id required'; END IF;
    SELECT status INTO v_status FROM public.content_versions WHERE id = NEW.published_version_id;
    SELECT final_decision INTO v_decision FROM public.council_verdicts WHERE content_version_id = NEW.published_version_id;
    IF v_status <> 'approved' OR v_decision <> 'approved' THEN
      RAISE EXCEPTION 'Publish blocked: version not approved (status=% verdict=%)', v_status, v_decision;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_publish_tutor_assets ON public.tutor_assets;
CREATE TRIGGER trg_guard_publish_tutor_assets BEFORE UPDATE ON public.tutor_assets FOR EACH ROW EXECUTE FUNCTION public.guard_publish_tutor_assets();

-- RLS (admin pattern matching marketing_assets)
ALTER TABLE public.tutor_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access tutor_assets" ON public.tutor_assets FOR ALL USING (true);
