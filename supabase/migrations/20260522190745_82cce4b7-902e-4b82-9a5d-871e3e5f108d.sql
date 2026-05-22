
-- P4 — Curriculum-Seed: GaLaBau, Wundexperte ICW, Drohnen A1/A3
-- 1) Extend certification_catalog.track CHECK to allow EXAM_FIRST_PLUS
ALTER TABLE public.certification_catalog
  DROP CONSTRAINT IF EXISTS certification_catalog_track_check;
ALTER TABLE public.certification_catalog
  ADD CONSTRAINT certification_catalog_track_check
  CHECK (track = ANY (ARRAY[
    'AUSBILDUNG_VOLL','EXAM_FIRST','EXAM_FIRST_PLUS','FACHWIRT','MEISTER',
    'BETRIEBSWIRT','SACHKUNDE','AEVO','PROJEKTMANAGEMENT','STUDIUM'
  ]));

-- 2) Audit contract
INSERT INTO public.ops_audit_contract(action_type, owner_module, required_keys, schema_version)
VALUES
  ('curriculum_seeded_p4', 'rollout_seed', ARRAY['curriculum_id','title','track','chamber'], 1)
ON CONFLICT (action_type) DO NOTHING;
