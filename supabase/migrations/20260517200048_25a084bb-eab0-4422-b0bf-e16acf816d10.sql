-- E3e.0 · Semantic Bridge Layer · Governance Schema (retry: named fn_emit_audit args)

CREATE TABLE IF NOT EXISTS public.seo_bridge_type_registry (
  link_type        text PRIMARY KEY,
  source_layer     text NOT NULL CHECK (source_layer IN ('contextual_blog','pillar_authority','cluster_intent','certification','persona_landing','exam_package')),
  target_layer     text NOT NULL CHECK (target_layer IN ('contextual_blog','pillar_authority','cluster_intent','certification','persona_landing','exam_package','learning_content')),
  purpose          text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  introduced_at    timestamptz NOT NULL DEFAULT now(),
  notes            text
);

ALTER TABLE public.seo_bridge_type_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seo_bridge_type_registry_service_all" ON public.seo_bridge_type_registry;
CREATE POLICY "seo_bridge_type_registry_service_all"
  ON public.seo_bridge_type_registry FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

DROP POLICY IF EXISTS "seo_bridge_type_registry_admin_read" ON public.seo_bridge_type_registry;
CREATE POLICY "seo_bridge_type_registry_admin_read"
  ON public.seo_bridge_type_registry FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.seo_bridge_governance (
  link_type                     text PRIMARY KEY REFERENCES public.seo_bridge_type_registry(link_type) ON DELETE CASCADE,
  max_outbound_per_source       integer NOT NULL DEFAULT 3  CHECK (max_outbound_per_source BETWEEN 1 AND 20),
  max_inbound_per_target        integer NOT NULL DEFAULT 10 CHECK (max_inbound_per_target  BETWEEN 1 AND 200),
  min_semantic_similarity       numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (min_semantic_similarity BETWEEN 0 AND 1),
  max_per_apply_run             integer NOT NULL DEFAULT 25 CHECK (max_per_apply_run BETWEEN 1 AND 200),
  requires_admin_approval       boolean NOT NULL DEFAULT true,
  entropy_dilution_max          numeric(3,2) NOT NULL DEFAULT 0.05 CHECK (entropy_dilution_max BETWEEN 0 AND 1),
  hop_depth_max_increase        integer NOT NULL DEFAULT 1  CHECK (hop_depth_max_increase BETWEEN 0 AND 6),
  notes                         text,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seo_bridge_governance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seo_bridge_governance_service_all" ON public.seo_bridge_governance;
CREATE POLICY "seo_bridge_governance_service_all"
  ON public.seo_bridge_governance FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

DROP POLICY IF EXISTS "seo_bridge_governance_admin_read" ON public.seo_bridge_governance;
CREATE POLICY "seo_bridge_governance_admin_read"
  ON public.seo_bridge_governance FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.seo_bridge_type_registry (link_type, source_layer, target_layer, purpose, notes) VALUES
  ('blog_to_pillar',                    'contextual_blog',  'pillar_authority', 'semantic → authority transfer',                   'Bridges blog discovery into commercial authority layer'),
  ('pillar_to_cornerstone_blog',        'pillar_authority', 'contextual_blog',  'authority → semantic reinforcement',              'Pillar pages link to canonical cornerstone blog explainer'),
  ('cluster_to_blog',                   'cluster_intent',   'contextual_blog',  'curriculum intent → semantic depth',              'Intent cluster pages reach into blog topical mesh'),
  ('blog_to_exam_package',              'contextual_blog',  'exam_package',     'intent transfer (discovery → conversion)',        'Conversion bridge; tightest gates'),
  ('certification_to_learning_content', 'certification',    'learning_content', 'topical reinforcement (authority → curriculum)',  'Certification page anchors learning content references')
ON CONFLICT (link_type) DO NOTHING;

INSERT INTO public.seo_bridge_governance
  (link_type, max_outbound_per_source, max_inbound_per_target, min_semantic_similarity, max_per_apply_run, requires_admin_approval, entropy_dilution_max, hop_depth_max_increase, notes)
VALUES
  ('blog_to_pillar',                    3, 20, 0.55, 25, true, 0.05, 1, 'Authority transfer; cap to protect blog entropy'),
  ('pillar_to_cornerstone_blog',        2, 15, 0.60, 25, true, 0.04, 1, 'Reverse direction; only canonical cornerstones'),
  ('cluster_to_blog',                   4, 30, 0.50, 50, true, 0.05, 1, 'Curriculum→discovery; widest fan-out'),
  ('blog_to_exam_package',              2, 10, 0.65, 15, true, 0.03, 1, 'Conversion bridge; tightest gates, smallest cap'),
  ('certification_to_learning_content', 3, 25, 0.55, 30, true, 0.05, 1, 'Reinforces curriculum from authority side')
ON CONFLICT (link_type) DO NOTHING;

INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module) VALUES
  ('seo_bridge_governance_initialized', ARRAY['phase','bridge_types_seeded','governance_rows_seeded'], 1, 'seo_bridge_layer'),
  ('seo_bridge_governance_updated',     ARRAY['link_type','field','old_value','new_value','actor_id'], 1, 'seo_bridge_layer'),
  ('seo_bridge_type_toggled',           ARRAY['link_type','is_active','actor_id'],                     1, 'seo_bridge_layer')
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE v_types int; v_gov int;
BEGIN
  SELECT COUNT(*) INTO v_types FROM public.seo_bridge_type_registry WHERE is_active;
  SELECT COUNT(*) INTO v_gov   FROM public.seo_bridge_governance;
  IF v_types <> 5 THEN RAISE EXCEPTION 'E3e.0 smoke: expected 5 bridge types, got %', v_types; END IF;
  IF v_gov   <> 5 THEN RAISE EXCEPTION 'E3e.0 smoke: expected 5 governance rows, got %', v_gov; END IF;
END $$;

SELECT public.fn_emit_audit(
  _action_type := 'seo_bridge_governance_initialized',
  _payload := jsonb_build_object(
    'phase', 'E3e.0',
    'bridge_types_seeded', 5,
    'governance_rows_seeded', 5,
    'subgraph_a_nodes', 118,
    'subgraph_b_nodes', 589,
    'strategy', 'controlled_bridging_option_a'
  )
);

-- Rollback-Hint:
--   DROP TABLE public.seo_bridge_governance;
--   DROP TABLE public.seo_bridge_type_registry;
--   DELETE FROM public.ops_audit_contract WHERE owner_module='seo_bridge_layer';