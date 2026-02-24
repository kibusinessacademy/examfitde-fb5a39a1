
-- 1) apply_phase2_enrichment: write-if-empty RPC for race-safe Phase 2 updates
CREATE OR REPLACE FUNCTION public.apply_phase2_enrichment(p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  comp_id uuid;
  misc jsonb;
  trans jsonb;
  updated int := 0;
  skipped int := 0;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    comp_id := (item->>'id')::uuid;
    misc := item->'typical_misconceptions';
    trans := item->'transfer_markers';

    -- Only write misconceptions if currently empty/null
    IF misc IS NOT NULL AND jsonb_array_length(misc) >= 2 THEN
      UPDATE competencies
      SET typical_misconceptions = misc,
          enrichment_version = COALESCE(enrichment_version, 0) + 1,
          enriched_at = now()
      WHERE id = comp_id
        AND (typical_misconceptions IS NULL 
             OR jsonb_array_length(COALESCE(typical_misconceptions, '[]'::jsonb)) < 2);
    END IF;

    -- Only write transfer_markers if currently empty/null
    IF trans IS NOT NULL AND jsonb_array_length(trans) >= 1 THEN
      UPDATE competencies
      SET transfer_markers = trans,
          enrichment_version = COALESCE(enrichment_version, 0) + 1,
          enriched_at = now()
      WHERE id = comp_id
        AND (transfer_markers IS NULL 
             OR jsonb_array_length(COALESCE(transfer_markers, '[]'::jsonb)) < 1);
    END IF;

    -- Check if anything was written
    IF FOUND THEN
      updated := updated + 1;
    ELSE
      skipped := skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', updated, 'skipped', skipped);
END;
$$;

-- 2) get_phase1_remaining_counts: proper count RPC (no limit 10000 hack)
CREATE OR REPLACE FUNCTION public.get_phase1_remaining_counts(p_curriculum_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  missing_bloom int;
  missing_tier int;
  missing_verb int;
BEGIN
  SELECT count(*) INTO missing_bloom
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE c.bloom_level IS NULL
    AND (p_curriculum_id IS NULL OR lf.curriculum_id = p_curriculum_id);

  SELECT count(*) INTO missing_tier
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE c.exam_relevance_tier IS NULL
    AND (p_curriculum_id IS NULL OR lf.curriculum_id = p_curriculum_id);

  SELECT count(*) INTO missing_verb
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE c.action_verb IS NULL
    AND (p_curriculum_id IS NULL OR lf.curriculum_id = p_curriculum_id);

  RETURN jsonb_build_object(
    'missing_bloom', missing_bloom,
    'missing_tier', missing_tier,
    'missing_verb', missing_verb
  );
END;
$$;

-- Register in RPC version registry
INSERT INTO rpc_version_registry (rpc_name, version)
VALUES 
  ('apply_phase2_enrichment', 1),
  ('get_phase1_remaining_counts', 1)
ON CONFLICT (rpc_name, version) DO UPDATE SET rpc_name = EXCLUDED.rpc_name;
