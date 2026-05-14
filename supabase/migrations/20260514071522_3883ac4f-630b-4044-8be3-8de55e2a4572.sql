CREATE TABLE IF NOT EXISTS public.seo_content_priority_queue (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id            uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  competency_id            uuid NOT NULL REFERENCES public.competencies(id) ON DELETE CASCADE,
  intent_key               text NOT NULL,
  persona_type             text NOT NULL DEFAULT 'azubi',
  semrush_volume           integer,
  kdi                      integer,
  business_value           integer,
  conversion_intent        integer,
  cluster_priority         integer,
  topical_authority_score  integer,
  generation_status        text NOT NULL DEFAULT 'planned'
    CHECK (generation_status IN ('planned','ready','queued','generating','generated','blocked_thin','failed','skipped')),
  thin_content_risk        text DEFAULT 'unknown'
    CHECK (thin_content_risk IN ('unknown','low','medium','high')),
  thin_content_reasons     jsonb,
  wave                     integer,
  notes                    text,
  last_evaluated_at        timestamptz,
  last_enqueued_at         timestamptz,
  last_generated_at        timestamptz,
  job_id                   uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_content_priority_queue_uniq UNIQUE (curriculum_id, competency_id, intent_key, persona_type)
);

CREATE INDEX IF NOT EXISTS idx_seo_cpq_status      ON public.seo_content_priority_queue(generation_status);
CREATE INDEX IF NOT EXISTS idx_seo_cpq_wave        ON public.seo_content_priority_queue(wave) WHERE wave IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_seo_cpq_curriculum ON public.seo_content_priority_queue(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_seo_cpq_intent     ON public.seo_content_priority_queue(intent_key);

ALTER TABLE public.seo_content_priority_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='seo_content_priority_queue' AND policyname='seo_cpq_admin_read') THEN
    CREATE POLICY seo_cpq_admin_read ON public.seo_content_priority_queue
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'admin'::app_role));
  END IF;
END $$;

REVOKE ALL ON public.seo_content_priority_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.seo_content_priority_queue TO service_role;

CREATE OR REPLACE FUNCTION public.fn_touch_updated_at_seo_cpq()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_seo_cpq ON public.seo_content_priority_queue;
CREATE TRIGGER trg_touch_seo_cpq
  BEFORE UPDATE ON public.seo_content_priority_queue
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at_seo_cpq();

COMMENT ON TABLE public.seo_content_priority_queue IS
  'SSOT für SEO-Intent-Page Priorisierung. Loop C3. Steuert wave-basiertes Enqueue + thin-content guard outcomes.';

CREATE OR REPLACE FUNCTION public.fn_seo_thin_content_guard(
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_intent_template text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp record;
  v_curr record;
  v_lf record;
  v_reasons text[] := ARRAY[]::text[];
  v_risk text := 'low';
  v_faq_count int := 0;
  v_internal_links int := 0;
  v_body_words int := 0;
  v_sibling_count int := 0;
  v_existing record;
  v_skel jsonb;
BEGIN
  SELECT id, title, description, learning_field_id, sort_order
    INTO v_comp FROM competencies WHERE id = p_competency_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'risk','high', 'reasons', to_jsonb(ARRAY['competency_not_found']));
  END IF;

  SELECT id, title INTO v_curr FROM curricula WHERE id = p_curriculum_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'risk','high', 'reasons', to_jsonb(ARRAY['curriculum_not_found']));
  END IF;

  SELECT id, title, curriculum_id INTO v_lf
    FROM learning_fields WHERE id = v_comp.learning_field_id;

  IF v_lf.id IS NULL OR v_lf.curriculum_id IS NULL OR v_lf.curriculum_id <> p_curriculum_id THEN
    v_reasons := array_append(v_reasons, 'competency_not_in_curriculum');
  END IF;

  IF coalesce(length(v_comp.description), 0) < 80 THEN
    v_reasons := array_append(v_reasons, 'competency_description_too_small');
  END IF;
  IF coalesce(length(v_comp.title), 0) < 6 THEN
    v_reasons := array_append(v_reasons, 'competency_title_too_short');
  END IF;

  SELECT count(*) INTO v_sibling_count
    FROM competencies c2 WHERE c2.learning_field_id = v_comp.learning_field_id;
  IF v_sibling_count < 2 THEN
    v_reasons := array_append(v_reasons, 'learning_field_too_thin');
  END IF;

  SELECT
    coalesce(jsonb_array_length(faq_json), 0),
    coalesce(jsonb_array_length(sections_json->'internal_links'), 0),
    coalesce(length(coalesce(sections_json->>'intro','')) +
             length(coalesce(sections_json->>'pain_points','')) +
             length(coalesce(sections_json->>'expert_tip','')), 0) / 6
    INTO v_faq_count, v_internal_links, v_body_words
  FROM seo_content_pages
  WHERE competency_id = p_competency_id
    AND intent_template = p_intent_template
    AND persona_type = 'azubi'
  LIMIT 1;

  IF v_faq_count = 0 AND v_internal_links = 0 THEN
    BEGIN
      v_skel := public.fn_seo_build_ssot_skeleton(p_curriculum_id, p_competency_id, p_intent_template);
      v_faq_count := coalesce(jsonb_array_length(v_skel->'faq_seed'), 0);
      v_internal_links := coalesce(jsonb_array_length(v_skel->'internal_links'), 0);
    EXCEPTION WHEN OTHERS THEN
      v_reasons := array_append(v_reasons, 'skeleton_unavailable');
    END;
  END IF;

  IF v_faq_count < 3 THEN
    v_reasons := array_append(v_reasons, 'faq_below_minimum_3');
  END IF;
  IF v_internal_links < 4 THEN
    v_reasons := array_append(v_reasons, 'internal_links_below_minimum_4');
  END IF;
  IF v_body_words > 0 AND v_body_words < 480 THEN
    v_reasons := array_append(v_reasons, 'existing_body_below_min_words');
  END IF;

  v_risk := CASE
    WHEN array_length(v_reasons,1) IS NULL THEN 'low'
    WHEN array_length(v_reasons,1) <= 1 THEN 'medium'
    ELSE 'high'
  END;

  RETURN jsonb_build_object(
    'ok', (array_length(v_reasons,1) IS NULL),
    'risk', v_risk,
    'reasons', coalesce(to_jsonb(v_reasons), '[]'::jsonb),
    'metrics', jsonb_build_object(
      'competency_description_len', coalesce(length(v_comp.description),0),
      'learning_field_competency_count', v_sibling_count,
      'faq_count', v_faq_count,
      'internal_links', v_internal_links,
      'existing_body_words', v_body_words
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_seo_thin_content_guard(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seo_thin_content_guard(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.fn_seo_thin_content_guard(uuid, uuid, text) IS
  'Loop C3 Pre-Generation Guard. Blocks intent-page generation when competency/skeleton produces SEO-thin content. Returns jsonb with ok/risk/reasons/metrics.';