-- Wave 15a: Placeholder-Guard (Step-Reset getrennt via insert tool)

-- ── 1. HARD GUARD: exam_question_variants ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_variant_placeholder_pollution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pattern text := '\{[A-Za-z_][A-Za-z0-9_]*\}';
BEGIN
  IF NEW.question_text IS NOT NULL AND NEW.question_text ~ v_pattern THEN
    RAISE EXCEPTION 'PLACEHOLDER_POLLUTION_QUESTION_TEXT: variant=% has unresolved placeholder',
      NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.answer_text IS NOT NULL AND NEW.answer_text ~ v_pattern THEN
    RAISE EXCEPTION 'PLACEHOLDER_POLLUTION_ANSWER_TEXT: variant=% has unresolved placeholder',
      NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_variant_placeholder_pollution ON public.exam_question_variants;
CREATE TRIGGER trg_guard_variant_placeholder_pollution
BEFORE INSERT OR UPDATE OF question_text, answer_text
ON public.exam_question_variants
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_variant_placeholder_pollution();

-- ── 2. SOFT GUARD: question_blueprints (auto-deprecate) ────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_blueprint_placeholder_soft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pattern text := '\{[A-Za-z_][A-Za-z0-9_]*\}';
BEGIN
  IF NEW.question_template IS NOT NULL AND NEW.question_template ~ v_pattern THEN
    NEW.status := 'deprecated'::blueprint_status;
    NEW.deprecated_at := COALESCE(NEW.deprecated_at, now());
    NEW.change_reason := COALESCE(NEW.change_reason || ' | ', '') 
                       || 'WAVE15A_AUTO_DEPRECATED: unresolved placeholder at ' || now()::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_blueprint_placeholder_soft ON public.question_blueprints;
CREATE TRIGGER trg_guard_blueprint_placeholder_soft
BEFORE INSERT OR UPDATE OF question_template
ON public.question_blueprints
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_blueprint_placeholder_soft();

-- ── 3. AUDIT-FUNKTION ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_placeholder_pollution()
RETURNS TABLE(
  source_table text,
  curriculum_id uuid,
  package_title text,
  total_polluted bigint,
  active_polluted bigint,
  sample_text text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    'exam_question_variants'::text, eqv.curriculum_id, cp.title,
    count(*), count(*) FILTER (WHERE eqv.status IN ('review','approved')),
    left((array_agg(eqv.question_text))[1], 120)
  FROM exam_question_variants eqv
  LEFT JOIN course_packages cp ON cp.curriculum_id = eqv.curriculum_id
  WHERE eqv.question_text ~ '\{[A-Za-z_][A-Za-z0-9_]*\}'
     OR eqv.answer_text ~ '\{[A-Za-z_][A-Za-z0-9_]*\}'
  GROUP BY eqv.curriculum_id, cp.title
  UNION ALL
  SELECT 
    'question_blueprints'::text, qb.curriculum_id, cp.title,
    count(*), count(*) FILTER (WHERE qb.status::text != 'deprecated'),
    left((array_agg(qb.question_template))[1], 120)
  FROM question_blueprints qb
  LEFT JOIN course_packages cp ON cp.curriculum_id = qb.curriculum_id
  WHERE qb.question_template ~ '\{[A-Za-z_][A-Za-z0-9_]*\}'
  GROUP BY qb.curriculum_id, cp.title;
$$;

-- ── 4. BB-Junk-Blueprint deprecaten ────────────────────────────────────
UPDATE public.question_blueprints qb
SET status = 'deprecated'::blueprint_status,
    deprecated_at = COALESCE(qb.deprecated_at, now()),
    change_reason = COALESCE(qb.change_reason || ' | ', '') 
                  || 'WAVE15A_HOLLOW_BLUEPRINT_CLEANUP at ' || now()::text
WHERE qb.curriculum_id IN (
  SELECT curriculum_id FROM course_packages WHERE id = '3f416f2f-4364-460c-8924-caa2316a12d0'
)
  AND qb.status::text != 'deprecated'
  AND qb.question_template ~ '\{[A-Za-z_][A-Za-z0-9_]*\}';

COMMENT ON FUNCTION public.fn_guard_variant_placeholder_pollution IS 
'Wave 15a HARD GUARD: blockiert Variants mit unsubstituierten Platzhaltern';
COMMENT ON FUNCTION public.fn_guard_blueprint_placeholder_soft IS 
'Wave 15a SOFT GUARD: auto-deprecate Blueprints mit unsubstituierten Platzhaltern';