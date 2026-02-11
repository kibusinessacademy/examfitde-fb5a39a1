
-- ═══════════════════════════════════════════════════════════════════
-- Blueprint Versioning + Write Guard on question_blueprints
-- ═══════════════════════════════════════════════════════════════════

-- 1) Blueprint version tracking table
CREATE TABLE IF NOT EXISTS public.blueprint_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blueprint_id uuid NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  version_number int NOT NULL DEFAULT 1,
  content_json jsonb NOT NULL, -- snapshot of template + variables + constraints + distractors + answers
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','under_review','approved','rejected')),
  council_round int NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.blueprint_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on blueprint_versions"
  ON public.blueprint_versions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Idempotency index
CREATE UNIQUE INDEX IF NOT EXISTS idx_bv_idempotency
  ON public.blueprint_versions (blueprint_id, version_number)
  WHERE status NOT IN ('rejected');

-- 2) Guard trigger: block direct edits to question_blueprints core fields
--    unless via publish path (council.publish_bypass session var)
CREATE OR REPLACE FUNCTION public.guard_blueprint_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow status changes (e.g. approved/rejected by council)
  IF OLD.question_template IS NOT DISTINCT FROM NEW.question_template
     AND OLD.explanation_template IS NOT DISTINCT FROM NEW.explanation_template
     AND OLD.canonical_statement IS NOT DISTINCT FROM NEW.canonical_statement
  THEN
    RETURN NEW;
  END IF;

  -- Allow bypass from publish path
  IF current_setting('council.publish_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'COUNCIL_BYPASS_BLOCKED: Direct writes to blueprint templates are forbidden. Use blueprint_versions → council → publish.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_blueprint_content'
    AND tgrelid = 'public.question_blueprints'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_blueprint_content
      BEFORE UPDATE ON public.question_blueprints
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_blueprint_writes();
  END IF;
END $$;

-- 3) Publish function for approved blueprint versions
CREATE OR REPLACE FUNCTION public.publish_approved_blueprint_version(
  p_blueprint_id uuid,
  p_version_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_content jsonb;
BEGIN
  SELECT status, content_json INTO v_status, v_content
  FROM public.blueprint_versions WHERE id = p_version_id AND blueprint_id = p_blueprint_id;

  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot publish blueprint version %, status=% (must be approved)', p_version_id, v_status;
  END IF;

  -- Set bypass and apply
  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE public.question_blueprints
  SET question_template = v_content->>'question_template',
      explanation_template = v_content->>'explanation_template',
      canonical_statement = v_content->>'canonical_statement',
      updated_at = now()
  WHERE id = p_blueprint_id;

  PERFORM set_config('council.publish_bypass', 'false', true);
END $$;
