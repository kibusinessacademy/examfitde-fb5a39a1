-- =========================================================
-- Berufs-KI Activation Layer
-- Manager Copilot + Automation + Executive Narrative + Suites
-- =========================================================

-- ---------- Tables ----------

CREATE TABLE IF NOT EXISTS public.berufs_ki_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify_channel text NOT NULL DEFAULT 'inapp',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, rule_key),
  CONSTRAINT berufs_ki_automation_rules_key_chk
    CHECK (rule_key IN ('risk_radar_alert','cohort_stagnation','recovery_low_impact','inactivity_14d','exam_readiness_drop'))
);

CREATE TABLE IF NOT EXISTS public.berufs_ki_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.berufs_ki_automation_rules(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  matched_count int NOT NULL DEFAULT 0,
  sample jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS idx_bki_automation_runs_org_ran ON public.berufs_ki_automation_runs(org_id, ran_at DESC);

CREATE TABLE IF NOT EXISTS public.berufs_ki_product_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  audience text NOT NULL,
  tagline text NOT NULL,
  description text NOT NULL,
  route text NOT NULL,
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- RLS ----------

ALTER TABLE public.berufs_ki_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berufs_ki_automation_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berufs_ki_product_suites   ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_is_org_manager(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.org_id = _org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.role IN ('owner','admin','manager')
  );
$$;

DROP POLICY IF EXISTS bki_auto_rules_read ON public.berufs_ki_automation_rules;
CREATE POLICY bki_auto_rules_read ON public.berufs_ki_automation_rules
  FOR SELECT TO authenticated USING (public.fn_is_org_manager(org_id));

DROP POLICY IF EXISTS bki_auto_rules_write ON public.berufs_ki_automation_rules;
CREATE POLICY bki_auto_rules_write ON public.berufs_ki_automation_rules
  FOR ALL TO authenticated USING (public.fn_is_org_manager(org_id)) WITH CHECK (public.fn_is_org_manager(org_id));

DROP POLICY IF EXISTS bki_auto_runs_read ON public.berufs_ki_automation_runs;
CREATE POLICY bki_auto_runs_read ON public.berufs_ki_automation_runs
  FOR SELECT TO authenticated USING (public.fn_is_org_manager(org_id));

DROP POLICY IF EXISTS bki_suites_read ON public.berufs_ki_product_suites;
CREATE POLICY bki_suites_read ON public.berufs_ki_product_suites
  FOR SELECT USING (active = true);

DROP POLICY IF EXISTS bki_suites_admin_write ON public.berufs_ki_product_suites;
CREATE POLICY bki_suites_admin_write ON public.berufs_ki_product_suites
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_bki_auto_rules_updated ON public.berufs_ki_automation_rules;
CREATE TRIGGER trg_bki_auto_rules_updated BEFORE UPDATE ON public.berufs_ki_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_bki_suites_updated ON public.berufs_ki_product_suites;
CREATE TRIGGER trg_bki_suites_updated BEFORE UPDATE ON public.berufs_ki_product_suites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Audit Contracts ----------

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('manager_copilot_brief_query', ARRAY['org_id','user_id','window_days','priority_count']::text[], 'berufs_ki_copilot'),
  ('automation_rule_upsert',      ARRAY['org_id','user_id','rule_key','enabled']::text[],          'berufs_ki_automation'),
  ('automation_org_evaluation',   ARRAY['org_id','user_id','rules_evaluated','total_matches']::text[], 'berufs_ki_automation'),
  ('executive_narrative_query',   ARRAY['org_id','user_id','window_days','bullet_count']::text[],  'berufs_ki_narrative')
ON CONFLICT (action_type) DO NOTHING;

-- ---------- Seed Suites ----------

INSERT INTO public.berufs_ki_product_suites (slug, name, audience, tagline, description, route, modules, sort_order) VALUES
('ausbildungsleiter','Ausbildungsleiter Suite','Ausbildungsleiter & HR-Entwicklung',
 'Tagesbriefing, Risiko-Radar und wirksame Interventionen — auf einer Oberfläche.',
 'Manager-Copilot mit deterministischen Prioritäten, Cohort-Trends, Standortvergleich, Recovery-Wirkung und Automationen für stagnierende Azubis.',
 '/berufs-ki/copilot',
 '["copilot","risk_radar","cohort_trends","automation","interventions"]'::jsonb, 10),
('pruefungsreife','Prüfungsreife Suite','Azubis & Ausbilder',
 'Vom Skill-Gap zur Prüfungsreife — graph-basierte Drills und Recovery.',
 'ExamFit-Graph-Bridge, Next-Best-Skill-Action, Oral-Trainer und Recovery-Empfehlungen aus dem Intelligence-Graph.',
 '/berufs-ki/graph-activation',
 '["graph_activation","examfit_bridge","next_best_action","oral_trainer"]'::jsonb, 20),
('risk_recovery','Risk Recovery Suite','Ausbildungsleitung & Coaching',
 'Risiken früh erkennen, gezielt eingreifen, Wirkung messen.',
 'Risk Radar, Recovery-Effectiveness, Intervention Impact und Automationen für Inaktivität und Prüfungsunsicherheit.',
 '/berufs-ki/intelligence',
 '["risk_radar","recovery","intervention_impact","automation"]'::jsonb, 30),
('standort_intelligence','Standort Intelligence Suite','Geschäftsführung & Multi-Standort-Verantwortliche',
 'Standort-Performance vergleichen, Cluster-Risiken erkennen, Best-Practices skalieren.',
 'Cross-Org Quality Score, Standortvergleich, Cohort-Trends, Cluster-Risk und Executive Narrative.',
 '/berufs-ki/intelligence/executive',
 '["org_quality","site_comparison","cluster_risk","executive_narrative"]'::jsonb, 40)
ON CONFLICT (slug) DO UPDATE SET
  name=EXCLUDED.name, audience=EXCLUDED.audience, tagline=EXCLUDED.tagline,
  description=EXCLUDED.description, route=EXCLUDED.route, modules=EXCLUDED.modules, sort_order=EXCLUDED.sort_order;

-- =========================================================
-- RPCs
-- =========================================================

-- ---------- Manager Copilot Brief ----------

CREATE OR REPLACE FUNCTION public.manager_copilot_get_brief(_org_id uuid, _days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_radar jsonb;
  v_cohorts jsonb;
  v_impact jsonb;
  v_recovery jsonb;
  v_graph_risk jsonb;
  v_priorities jsonb := '[]'::jsonb;
  v_d int := GREATEST(1, COALESCE(_days, 7));
BEGIN
  IF NOT public.fn_is_org_manager(_org_id) THEN
    RETURN jsonb_build_object('reason','NOT_AUTHORIZED','priorities','[]'::jsonb);
  END IF;

  v_radar      := public.manager_get_risk_radar(_org_id, v_d);
  v_cohorts    := public.manager_get_cohort_trends(_org_id, v_d);
  v_impact     := public.manager_get_intervention_impact(_org_id, v_d);
  v_recovery   := public.manager_get_recovery_effectiveness(_org_id, v_d);
  v_graph_risk := public.manager_get_graph_risk_explanations(v_d);

  -- 1) inactive learners (highest weight)
  IF (v_radar->'dimensions') IS NOT NULL THEN
    SELECT v_priorities || jsonb_build_array(jsonb_build_object(
      'priority', 1,
      'kind', 'inactivity',
      'severity', CASE WHEN (d->>'value')::int > 0 THEN 'high' ELSE 'low' END,
      'title', '14-Tage-Inaktivität',
      'count', (d->>'value')::int,
      'total', (d->>'total')::int,
      'action', 'Reminder oder Coaching-Slot anbieten',
      'route', '/berufs-ki/intelligence'
    )) INTO v_priorities
    FROM jsonb_array_elements(v_radar->'dimensions') d
    WHERE d->>'key' = 'inactive_14d';
  END IF;

  -- 2) at-risk competency clusters
  IF (v_radar->'dimensions') IS NOT NULL THEN
    SELECT v_priorities || jsonb_build_array(jsonb_build_object(
      'priority', 2,
      'kind', 'at_risk_competency',
      'severity', CASE WHEN (d->>'value')::int >= 3 THEN 'high' WHEN (d->>'value')::int >= 1 THEN 'medium' ELSE 'low' END,
      'title', 'Kritische Kompetenz-Cluster',
      'count', (d->>'value')::int,
      'total', (d->>'total')::int,
      'action', 'Recovery-Plan & Drill-Session starten',
      'route', '/berufs-ki/intelligence/executive'
    )) INTO v_priorities
    FROM jsonb_array_elements(v_radar->'dimensions') d
    WHERE d->>'key' = 'at_risk_competency';
  END IF;

  -- 3) declining cohorts
  IF (v_cohorts->'rows') IS NOT NULL THEN
    SELECT v_priorities || COALESCE(jsonb_agg(jsonb_build_object(
      'priority', 3,
      'kind', 'cohort_decline',
      'severity', CASE WHEN c->>'band' = 'red' THEN 'high' ELSE 'medium' END,
      'title', 'Cohort verliert Tempo: ' || COALESCE(c->>'name','—'),
      'delta', (c->>'delta')::numeric,
      'avg_score', (c->>'avg_score')::numeric,
      'action', 'Cohort-Meeting + gezielte Wiederholung',
      'route', '/berufs-ki/intelligence/executive'
    )), '[]'::jsonb) INTO v_priorities
    FROM jsonb_array_elements(v_cohorts->'rows') c
    WHERE (c->>'trend') = 'decline'
    LIMIT 3;
  END IF;

  -- 4) graph risk explanations (top 3)
  IF (v_graph_risk->'items') IS NOT NULL THEN
    SELECT v_priorities || COALESCE(jsonb_agg(jsonb_build_object(
      'priority', 4,
      'kind', 'graph_risk',
      'severity', CASE WHEN (g->>'avg_mastery')::numeric < 0.4 THEN 'high' ELSE 'medium' END,
      'title', 'Risiko-Kompetenz: ' || COALESCE(g->>'competency_title','(unbenannt)'),
      'learners_affected', (g->>'learners_affected')::int,
      'avg_mastery', (g->>'avg_mastery')::numeric,
      'action', 'Suggested Actions aus Graph anwenden',
      'route', '/berufs-ki/graph-activation'
    )), '[]'::jsonb) INTO v_priorities
    FROM jsonb_array_elements(v_graph_risk->'items') g
    LIMIT 3;
  END IF;

  PERFORM public.fn_emit_audit(
    'manager_copilot_brief_query',
    jsonb_build_object(
      'org_id', _org_id,
      'user_id', v_uid,
      'window_days', v_d,
      'priority_count', jsonb_array_length(v_priorities)
    )
  );

  RETURN jsonb_build_object(
    'reason','OK',
    'org_id', _org_id,
    'window_days', v_d,
    'generated_at', now(),
    'priorities', v_priorities,
    'snapshot', jsonb_build_object(
      'total_learners', COALESCE((v_radar->>'total_learners')::int, 0),
      'best_intervention', (SELECT jsonb_build_object('action_key', r->>'action_key', 'avg_outcome_score', (r->>'avg_outcome_score')::numeric)
                            FROM jsonb_array_elements(COALESCE(v_impact->'rows','[]'::jsonb)) r ORDER BY (r->>'avg_outcome_score')::numeric DESC NULLS LAST LIMIT 1),
      'weakest_intervention', (SELECT jsonb_build_object('action_key', r->>'action_key', 'avg_outcome_score', (r->>'avg_outcome_score')::numeric)
                               FROM jsonb_array_elements(COALESCE(v_impact->'rows','[]'::jsonb)) r ORDER BY (r->>'avg_outcome_score')::numeric ASC NULLS LAST LIMIT 1),
      'avg_risk_reduction', COALESCE(((v_recovery->'total')->>'avg_risk_reduction')::numeric, 0)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_copilot_get_brief(uuid,int) TO authenticated;

-- ---------- Automation ----------

CREATE OR REPLACE FUNCTION public.automation_list_rules(_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.fn_is_org_manager(_org_id) THEN
    RETURN jsonb_build_object('reason','NOT_AUTHORIZED','rules','[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'rule_key', rule_key, 'enabled', enabled,
    'params', params, 'notify_channel', notify_channel,
    'updated_at', updated_at
  ) ORDER BY rule_key), '[]'::jsonb)
  INTO v FROM public.berufs_ki_automation_rules WHERE org_id = _org_id;
  RETURN jsonb_build_object('reason','OK','org_id',_org_id,'rules',v);
END;
$$;

CREATE OR REPLACE FUNCTION public.automation_upsert_rule(
  _org_id uuid, _rule_key text, _enabled boolean, _params jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF NOT public.fn_is_org_manager(_org_id) THEN
    RETURN jsonb_build_object('reason','NOT_AUTHORIZED');
  END IF;
  INSERT INTO public.berufs_ki_automation_rules (org_id, rule_key, enabled, params, created_by)
  VALUES (_org_id, _rule_key, _enabled, COALESCE(_params,'{}'::jsonb), v_uid)
  ON CONFLICT (org_id, rule_key) DO UPDATE
    SET enabled = EXCLUDED.enabled, params = EXCLUDED.params, updated_at = now()
  RETURNING id INTO v_id;

  PERFORM public.fn_emit_audit('automation_rule_upsert', jsonb_build_object(
    'org_id', _org_id, 'user_id', v_uid, 'rule_key', _rule_key, 'enabled', _enabled
  ));
  RETURN jsonb_build_object('reason','OK','id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.automation_evaluate_org(_org_id uuid, _days int DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rule record;
  v_radar jsonb;
  v_cohorts jsonb;
  v_recovery jsonb;
  v_match int;
  v_sample jsonb;
  v_total int := 0;
  v_count int := 0;
  v_runs jsonb := '[]'::jsonb;
  v_d int := GREATEST(1, COALESCE(_days, 7));
BEGIN
  IF NOT public.fn_is_org_manager(_org_id) THEN
    RETURN jsonb_build_object('reason','NOT_AUTHORIZED');
  END IF;

  v_radar    := public.manager_get_risk_radar(_org_id, v_d);
  v_cohorts  := public.manager_get_cohort_trends(_org_id, v_d);
  v_recovery := public.manager_get_recovery_effectiveness(_org_id, v_d);

  FOR v_rule IN
    SELECT * FROM public.berufs_ki_automation_rules WHERE org_id = _org_id AND enabled = true
  LOOP
    v_match := 0; v_sample := '[]'::jsonb; v_count := v_count + 1;

    IF v_rule.rule_key = 'risk_radar_alert' THEN
      SELECT COALESCE(SUM((d->>'value')::int),0) INTO v_match
      FROM jsonb_array_elements(COALESCE(v_radar->'dimensions','[]'::jsonb)) d
      WHERE d->>'key' IN ('at_risk_competency','low_recovery','low_exam_confidence');
      v_sample := COALESCE(v_radar->'dimensions','[]'::jsonb);

    ELSIF v_rule.rule_key = 'cohort_stagnation' THEN
      SELECT COUNT(*)::int, COALESCE(jsonb_agg(c) FILTER (WHERE c IS NOT NULL),'[]'::jsonb)
      INTO v_match, v_sample
      FROM (
        SELECT c FROM jsonb_array_elements(COALESCE(v_cohorts->'rows','[]'::jsonb)) c
        WHERE (c->>'trend') IN ('decline','stagnation') LIMIT 10
      ) sub;

    ELSIF v_rule.rule_key = 'recovery_low_impact' THEN
      IF COALESCE(((v_recovery->'total')->>'avg_risk_reduction')::numeric, 0) <
         COALESCE((v_rule.params->>'min_risk_reduction')::numeric, 15) THEN
        v_match := 1;
        v_sample := jsonb_build_array(v_recovery->'total');
      END IF;

    ELSIF v_rule.rule_key = 'inactivity_14d' THEN
      SELECT (d->>'value')::int INTO v_match
      FROM jsonb_array_elements(COALESCE(v_radar->'dimensions','[]'::jsonb)) d
      WHERE d->>'key' = 'inactive_14d' LIMIT 1;
      v_sample := jsonb_build_array(jsonb_build_object('count', v_match));

    ELSIF v_rule.rule_key = 'exam_readiness_drop' THEN
      SELECT (d->>'value')::int INTO v_match
      FROM jsonb_array_elements(COALESCE(v_radar->'dimensions','[]'::jsonb)) d
      WHERE d->>'key' = 'low_exam_confidence' LIMIT 1;
      v_sample := jsonb_build_array(jsonb_build_object('count', v_match));
    END IF;

    v_match := COALESCE(v_match, 0);
    v_total := v_total + v_match;

    INSERT INTO public.berufs_ki_automation_runs (rule_id, org_id, matched_count, sample, status)
    VALUES (v_rule.id, _org_id, v_match, v_sample, 'ok');

    v_runs := v_runs || jsonb_build_array(jsonb_build_object(
      'rule_key', v_rule.rule_key, 'matched', v_match
    ));
  END LOOP;

  PERFORM public.fn_emit_audit('automation_org_evaluation', jsonb_build_object(
    'org_id', _org_id, 'user_id', v_uid,
    'rules_evaluated', v_count, 'total_matches', v_total
  ));

  RETURN jsonb_build_object('reason','OK','rules_evaluated',v_count,'total_matches',v_total,'runs',v_runs);
END;
$$;

GRANT EXECUTE ON FUNCTION public.automation_list_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.automation_upsert_rule(uuid,text,boolean,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.automation_evaluate_org(uuid,int) TO authenticated;

-- ---------- Executive Narrative ----------

CREATE OR REPLACE FUNCTION public.executive_get_narrative(_org_id uuid, _days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q jsonb;
  v_cohorts jsonb;
  v_impact jsonb;
  v_bullets jsonb := '[]'::jsonb;
  v_top_site jsonb; v_crit jsonb;
  v_top_int jsonb; v_weak_int jsonb;
  v_big_delta jsonb;
  v_d int := GREATEST(1, COALESCE(_days, 30));
BEGIN
  IF NOT public.fn_is_org_manager(_org_id) THEN
    RETURN jsonb_build_object('reason','NOT_AUTHORIZED','bullets','[]'::jsonb);
  END IF;

  v_q       := public.manager_get_org_training_quality(_org_id, v_d);
  v_cohorts := public.manager_get_cohort_trends(_org_id, v_d);
  v_impact  := public.manager_get_intervention_impact(_org_id, v_d);

  v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
    'kind','headline',
    'text', format('Org Training Quality Score: %s (%s)',
                   COALESCE((v_q->>'org_training_quality_score')::int, 0),
                   UPPER(COALESCE(v_q->>'band','no_data')))
  ));

  v_top_site := v_q->'insights'->'top_site';
  IF v_top_site IS NOT NULL AND v_top_site <> 'null'::jsonb THEN
    v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
      'kind','strength',
      'text', format('Stärkster Standort: %s (Ø %s)', v_top_site->>'name', v_top_site->>'avg_score')
    ));
  END IF;

  v_crit := v_q->'insights'->'critical_cohort';
  IF v_crit IS NOT NULL AND v_crit <> 'null'::jsonb THEN
    v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
      'kind','risk',
      'text', format('Kritischste Cohort: %s (Ø %s) — Recovery-Plan empfohlen.', v_crit->>'name', v_crit->>'avg_score')
    ));
  END IF;

  SELECT r INTO v_top_int FROM jsonb_array_elements(COALESCE(v_impact->'rows','[]'::jsonb)) r
   ORDER BY (r->>'avg_outcome_score')::numeric DESC NULLS LAST LIMIT 1;
  IF v_top_int IS NOT NULL THEN
    v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
      'kind','intervention_best',
      'text', format('Wirkungsstärkste Maßnahme: %s (Ø %s)', v_top_int->>'action_key', v_top_int->>'avg_outcome_score')
    ));
  END IF;

  SELECT r INTO v_weak_int FROM jsonb_array_elements(COALESCE(v_impact->'rows','[]'::jsonb)) r
   ORDER BY (r->>'avg_outcome_score')::numeric ASC NULLS LAST LIMIT 1;
  IF v_weak_int IS NOT NULL AND (v_top_int IS NULL OR v_weak_int->>'action_key' <> v_top_int->>'action_key') THEN
    v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
      'kind','intervention_weak',
      'text', format('Schwächste Maßnahme: %s (Ø %s) — Format überdenken.', v_weak_int->>'action_key', v_weak_int->>'avg_outcome_score')
    ));
  END IF;

  SELECT c INTO v_big_delta FROM jsonb_array_elements(COALESCE(v_cohorts->'rows','[]'::jsonb)) c
   ORDER BY ABS(COALESCE((c->>'delta')::numeric, 0)) DESC LIMIT 1;
  IF v_big_delta IS NOT NULL AND COALESCE((v_big_delta->>'delta')::numeric, 0) <> 0 THEN
    v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
      'kind','trend',
      'text', format('Größte Trendbewegung: %s (Δ %s)', v_big_delta->>'name', v_big_delta->>'delta')
    ));
  END IF;

  PERFORM public.fn_emit_audit('executive_narrative_query', jsonb_build_object(
    'org_id', _org_id, 'user_id', v_uid,
    'window_days', v_d, 'bullet_count', jsonb_array_length(v_bullets)
  ));

  RETURN jsonb_build_object(
    'reason','OK','org_id',_org_id,'window_days',v_d,
    'generated_at', now(), 'bullets', v_bullets
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.executive_get_narrative(uuid,int) TO authenticated;