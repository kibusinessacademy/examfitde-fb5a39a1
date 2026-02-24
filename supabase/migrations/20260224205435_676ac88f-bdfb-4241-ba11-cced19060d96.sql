
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
  wrote boolean;
  rc int;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    -- Fix #2: Guarantee clean state per iteration
    wrote := false;
    rc := 0;

    -- Defensive UUID parsing
    BEGIN
      comp_id := NULLIF(item->>'id', '')::uuid;
    EXCEPTION WHEN others THEN
      skipped := skipped + 1;
      CONTINUE;
    END;
    IF comp_id IS NULL THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    misc := item->'typical_misconceptions';
    trans := item->'transfer_markers';

    -- Fix #3: Integrate enrichment_version bump into write UPDATEs
    IF misc IS NOT NULL AND jsonb_typeof(misc) = 'array' AND jsonb_array_length(misc) >= 2 THEN
      UPDATE competencies
      SET typical_misconceptions = misc,
          enrichment_version = COALESCE(enrichment_version, 0) + 1,
          enriched_at = now()
      WHERE id = comp_id
        AND (typical_misconceptions IS NULL
          OR jsonb_array_length(COALESCE(typical_misconceptions, '[]'::jsonb)) < 2);
      GET DIAGNOSTICS rc = ROW_COUNT;
      IF rc > 0 THEN wrote := true; END IF;
    END IF;

    IF trans IS NOT NULL AND jsonb_typeof(trans) = 'array' AND jsonb_array_length(trans) >= 1 THEN
      UPDATE competencies
      SET transfer_markers = trans,
          enrichment_version = COALESCE(enrichment_version, 0) + 1,
          enriched_at = now()
      WHERE id = comp_id
        AND (transfer_markers IS NULL
          OR jsonb_array_length(COALESCE(transfer_markers, '[]'::jsonb)) < 1);
      GET DIAGNOSTICS rc = ROW_COUNT;
      IF rc > 0 THEN wrote := true; END IF;
    END IF;

    IF wrote THEN
      updated := updated + 1;
    ELSE
      skipped := skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', updated, 'skipped', skipped);
END;
$$;
