
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'persona_key') THEN
    CREATE TYPE public.persona_key AS ENUM (
      'azubi','ausbilder','hr_leitung','berufsschule_ihk','admin_ops'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.persona_registry (
  persona_key public.persona_key PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL,
  responsibility_scope text NOT NULL,
  default_risk_profile text NOT NULL CHECK (default_risk_profile IN ('low','medium','high')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.persona_registry TO authenticated;
GRANT ALL ON public.persona_registry TO service_role;

ALTER TABLE public.persona_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS persona_registry_admin_read ON public.persona_registry;
CREATE POLICY persona_registry_admin_read ON public.persona_registry
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.persona_registry (persona_key, display_name, description, responsibility_scope, default_risk_profile, sort_order)
VALUES
  ('azubi','Azubi / Lernender',
   'Person in Ausbildung oder Weiterbildung. Konsumiert Inhalte, schreibt Pruefungen, nutzt KI-Tutor.',
   'Lernen, Verstaendnis, Pruefungsvorbereitung, Bedienbarkeit','medium',10),
  ('ausbilder','Ausbilder / Trainer',
   'Person, die Azubis fachlich anleitet, Lernfortschritt prueft und Lernpakete kuratiert.',
   'Curriculum-Qualitaet, Lernpfade, Bewertung, Vertrauen ins Material','medium',20),
  ('hr_leitung','HR / Geschaeftsleitung',
   'Verantwortlich fuer Personalentwicklung, Budget und Compliance-Effekte der Plattform.',
   'Kosten, Reporting, Nachweisbarkeit, Personalrisiko, Conversion','high',30),
  ('berufsschule_ihk','Berufsschule / IHK',
   'Institutioneller Stakeholder: Lehrplan, Pruefungsordnung, externe Anerkennung.',
   'Rechtliche Konformitaet, Curriculum-Kohaerenz, Reputation','high',40),
  ('admin_ops','Admin / Operations',
   'Plattform-Operator: technische Stabilitaet, Daten-Integritaet, Audit, Notfall-Rollback.',
   'Datenkonsistenz, Beobachtbarkeit, Sicherheit, Rollback-Faehigkeit','high',50)
ON CONFLICT (persona_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    responsibility_scope = EXCLUDED.responsibility_scope,
    default_risk_profile = EXCLUDED.default_risk_profile,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.fn_persona_composite_score(
  _utility numeric, _risk numeric, _comprehension numeric, _conversion_learning numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND((
      0.35 * COALESCE(_utility,0)
    + 0.25 * (1 - COALESCE(_risk,1))
    + 0.20 * COALESCE(_comprehension,0)
    + 0.20 * COALESCE(_conversion_learning,0)
  )::numeric, 4);
$$;

CREATE TABLE IF NOT EXISTS public.outcome_fix_persona_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.outcome_fix_proposals(id) ON DELETE CASCADE,
  persona_key public.persona_key NOT NULL,
  utility_score numeric NOT NULL CHECK (utility_score BETWEEN 0 AND 1),
  risk_score numeric NOT NULL CHECK (risk_score BETWEEN 0 AND 1),
  comprehension_score numeric NOT NULL CHECK (comprehension_score BETWEEN 0 AND 1),
  conversion_learning_score numeric NOT NULL CHECK (conversion_learning_score BETWEEN 0 AND 1),
  composite_score numeric NOT NULL,
  rationale text NOT NULL CHECK (length(rationale) >= 16),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  simulated_by uuid,
  simulated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, persona_key)
);

GRANT SELECT ON public.outcome_fix_persona_simulations TO authenticated;
GRANT ALL ON public.outcome_fix_persona_simulations TO service_role;

ALTER TABLE public.outcome_fix_persona_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofps_admin_read ON public.outcome_fix_persona_simulations;
CREATE POLICY ofps_admin_read ON public.outcome_fix_persona_simulations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_ofps_proposal ON public.outcome_fix_persona_simulations(proposal_id);
CREATE INDEX IF NOT EXISTS idx_ofps_persona ON public.outcome_fix_persona_simulations(persona_key);
CREATE INDEX IF NOT EXISTS idx_ofps_composite ON public.outcome_fix_persona_simulations(composite_score DESC);

DROP VIEW IF EXISTS public.v_outcome_fix_persona_matrix;
CREATE VIEW public.v_outcome_fix_persona_matrix AS
WITH agg AS (
  SELECT
    s.proposal_id,
    COUNT(*)::int                              AS personas_simulated,
    ROUND(AVG(s.composite_score)::numeric, 4)  AS avg_composite,
    ROUND(MAX(s.utility_score)::numeric, 4)    AS max_utility,
    ROUND(MIN(s.utility_score)::numeric, 4)    AS min_utility,
    ROUND(MAX(s.risk_score)::numeric, 4)       AS max_risk,
    (ARRAY_AGG(s.persona_key ORDER BY s.composite_score DESC))[1] AS best_persona,
    (ARRAY_AGG(s.persona_key ORDER BY s.composite_score ASC))[1]  AS worst_persona,
    BOOL_OR(s.utility_score >= 0.7)            AS has_strong_winner,
    BOOL_OR(s.risk_score    >= 0.7)            AS has_high_risk_persona
  FROM public.outcome_fix_persona_simulations s
  GROUP BY s.proposal_id
)
SELECT
  p.id                            AS proposal_id,
  p.proposal_key,
  p.title,
  p.vertical_key,
  p.review_state,
  public.fn_outcome_fix_priority(
    CASE p.severity
      WHEN 'critical' THEN 1.0 WHEN 'high' THEN 0.8
      WHEN 'medium' THEN 0.5 WHEN 'low' THEN 0.3 ELSE 0.5
    END,
    p.business_impact_score, p.confidence_score, p.risk_score
  ) AS priority_score,
  COALESCE(a.personas_simulated, 0) AS personas_simulated,
  a.avg_composite, a.best_persona, a.worst_persona,
  a.max_utility, a.min_utility, a.max_risk,
  CASE WHEN a.max_utility IS NOT NULL AND a.min_utility IS NOT NULL
       THEN ROUND((a.max_utility - a.min_utility)::numeric, 4) END AS utility_spread,
  COALESCE(a.has_strong_winner AND a.has_high_risk_persona, false) AS is_conflicted
FROM public.outcome_fix_proposals p
LEFT JOIN agg a ON a.proposal_id = p.id;

REVOKE ALL ON public.v_outcome_fix_persona_matrix FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_outcome_fix_persona_matrix TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_personas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'persona_key', persona_key, 'display_name', display_name,
      'description', description, 'responsibility_scope', responsibility_scope,
      'default_risk_profile', default_risk_profile, 'sort_order', sort_order
    ) ORDER BY sort_order)
    FROM public.persona_registry
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_simulate_proposal_persona(
  _proposal_id uuid, _persona_key public.persona_key,
  _utility_score numeric, _risk_score numeric,
  _comprehension_score numeric, _conversion_learning_score numeric,
  _rationale text, _evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_composite numeric; v_state text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT review_state::text INTO v_state FROM public.outcome_fix_proposals WHERE id = _proposal_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_state IN ('approved','rejected','withdrawn','expired') THEN
    RAISE EXCEPTION 'proposal_locked_for_simulation: state=%', v_state USING ERRCODE = '22023';
  END IF;
  v_composite := public.fn_persona_composite_score(
    _utility_score, _risk_score, _comprehension_score, _conversion_learning_score
  );
  INSERT INTO public.outcome_fix_persona_simulations (
    proposal_id, persona_key, utility_score, risk_score,
    comprehension_score, conversion_learning_score,
    composite_score, rationale, evidence, simulated_by
  ) VALUES (
    _proposal_id, _persona_key, _utility_score, _risk_score,
    _comprehension_score, _conversion_learning_score,
    v_composite, _rationale, COALESCE(_evidence,'{}'::jsonb), auth.uid()
  )
  ON CONFLICT (proposal_id, persona_key) DO UPDATE
    SET utility_score = EXCLUDED.utility_score,
        risk_score = EXCLUDED.risk_score,
        comprehension_score = EXCLUDED.comprehension_score,
        conversion_learning_score = EXCLUDED.conversion_learning_score,
        composite_score = EXCLUDED.composite_score,
        rationale = EXCLUDED.rationale,
        evidence = EXCLUDED.evidence,
        simulated_by = EXCLUDED.simulated_by,
        updated_at = now()
  RETURNING id INTO v_id;
  PERFORM public.fn_emit_audit(
    'persona_simulation_recorded',
    jsonb_build_object(
      'proposal_id', _proposal_id, 'persona_key', _persona_key,
      'composite_score', v_composite, 'utility_score', _utility_score,
      'risk_score', _risk_score, 'simulation_id', v_id
    )
  );
  RETURN jsonb_build_object(
    'simulation_id', v_id, 'composite_score', v_composite,
    'proposal_id', _proposal_id, 'persona_key', _persona_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_persona_simulation(
  _proposal_id uuid, _persona_key public.persona_key, _reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deleted int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 8 THEN
    RAISE EXCEPTION 'reason_too_short' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.outcome_fix_persona_simulations
   WHERE proposal_id = _proposal_id AND persona_key = _persona_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM public.fn_emit_audit(
    'persona_simulation_cleared',
    jsonb_build_object(
      'proposal_id', _proposal_id, 'persona_key', _persona_key,
      'reason', _reason, 'deleted', v_deleted
    )
  );
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_persona_simulations(_proposal_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'proposal_id', _proposal_id,
    'simulations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'persona_key', s.persona_key,
        'persona_name', r.display_name,
        'responsibility_scope', r.responsibility_scope,
        'default_risk_profile', r.default_risk_profile,
        'utility_score', s.utility_score, 'risk_score', s.risk_score,
        'comprehension_score', s.comprehension_score,
        'conversion_learning_score', s.conversion_learning_score,
        'composite_score', s.composite_score,
        'rationale', s.rationale, 'evidence', s.evidence,
        'simulated_by', s.simulated_by,
        'simulated_at', s.simulated_at, 'updated_at', s.updated_at
      ) ORDER BY r.sort_order)
      FROM public.outcome_fix_persona_simulations s
      JOIN public.persona_registry r ON r.persona_key = s.persona_key
      WHERE s.proposal_id = _proposal_id
    ), '[]'::jsonb),
    'matrix', (
      SELECT to_jsonb(m.*) FROM public.v_outcome_fix_persona_matrix m
      WHERE m.proposal_id = _proposal_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_persona_conflict_matrix(
  _vertical_key text DEFAULT NULL,
  _only_conflicts boolean DEFAULT false,
  _limit int DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(t.*))
    FROM (
      SELECT *
      FROM public.v_outcome_fix_persona_matrix m
      WHERE (_vertical_key IS NULL OR m.vertical_key = _vertical_key)
        AND (_only_conflicts = false OR m.is_conflicted = true)
        AND m.personas_simulated > 0
      ORDER BY m.is_conflicted DESC, m.utility_spread DESC NULLS LAST
      LIMIT GREATEST(1, LEAST(_limit, 500))
    ) t
  ), '[]'::jsonb);
END;
$$;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('persona_simulation_recorded',
   ARRAY['proposal_id','persona_key','composite_score'],
   'berufs-ki.cut-2-5'),
  ('persona_simulation_cleared',
   ARRAY['proposal_id','persona_key','reason'],
   'berufs-ki.cut-2-5')
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    owner_module = EXCLUDED.owner_module,
    updated_at = now();
