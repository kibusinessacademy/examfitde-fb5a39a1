CREATE OR REPLACE FUNCTION public.guard_building_requires_enrichment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  total_comps bigint;
  enriched_comps bigint;
  curr_id uuid;
BEGIN
  -- Only fire when status changes TO 'building'
  IF NEW.status = 'building' AND (OLD.status IS DISTINCT FROM 'building') THEN
    -- EXAM_FIRST and EXAM_FIRST_PLUS tracks skip enrichment gate
    IF NEW.track IS NOT NULL AND NEW.track::text IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS') THEN
      RETURN NEW;
    END IF;

    curr_id := NEW.curriculum_id;
    
    IF curr_id IS NOT NULL THEN
      SELECT count(*), 
             count(*) FILTER (WHERE comp.enrichment_version >= 2)
      INTO total_comps, enriched_comps
      FROM learning_fields lf
      JOIN competencies comp ON comp.learning_field_id = lf.id
      WHERE lf.curriculum_id = curr_id;
    ELSE
      total_comps := 0;
      enriched_comps := 0;
    END IF;

    -- Block if enrichment is not complete (allow if 0 comps = no curriculum data yet)
    IF total_comps > 0 AND enriched_comps < total_comps THEN
      NEW.status := 'queued';
      NEW.blocked_reason := format(
        'ENRICHMENT_GATE: %s/%s competencies enriched (%s%%). Waiting for mass-enrich completion.',
        enriched_comps, total_comps, round(100.0 * enriched_comps / total_comps)
      );
      NEW.updated_at := now();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;