
-- 1. Update trigger to allow admin bypass (when blocked_reason is explicitly cleared)
CREATE OR REPLACE FUNCTION public.guard_building_requires_enrichment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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

    -- Admin bypass: if blocked_reason is being explicitly cleared (admin override), allow transition
    IF OLD.blocked_reason IS NOT NULL AND NEW.blocked_reason IS NULL THEN
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
$$;

-- 2. Force-bypass the 3 ENRICHMENT_GATE packages to building
UPDATE course_packages
SET status = 'building', blocked_reason = NULL, stuck_reason = NULL, updated_at = now()
WHERE id IN (
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  'c5000000-0004-4000-8000-000000000001',
  'a0b0c0d0-0010-4000-8000-000000000001'
)
AND status = 'queued'
AND blocked_reason LIKE 'ENRICHMENT_GATE%';
