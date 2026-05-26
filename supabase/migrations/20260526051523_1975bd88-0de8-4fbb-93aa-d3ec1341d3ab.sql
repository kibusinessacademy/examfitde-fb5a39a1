
-- BerufOS Graph Activation Layer (Phase 1)
-- 5 deterministic, scope-gated, evidence-based RPCs.
-- NO new tables, NO parallel edges, NO AI calls.

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('graph_activation_learner_skill_query',  ARRAY['user_id','returned','reason']::text[], 'berufos_graph_activation'),
  ('graph_activation_tutor_context_query',  ARRAY['user_id','scope_node','returned','reason']::text[], 'berufos_graph_activation'),
  ('graph_activation_workflow_reco_query',  ARRAY['user_id','returned','reason']::text[], 'berufos_graph_activation'),
  ('graph_activation_manager_risk_explain', ARRAY['user_id','window_days','returned','reason']::text[], 'berufos_graph_activation'),
  ('graph_activation_examfit_bridge_query', ARRAY['user_id','certification_id','returned','reason']::text[], 'berufos_graph_activation')
ON CONFLICT (action_type) DO NOTHING;

-- Helper
CREATE OR REPLACE FUNCTION public.fn_bki_node_for_competency(p_competency_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.berufs_ki_graph_nodes
   WHERE node_type='competency' AND status='active' AND source_ref_id = p_competency_id LIMIT 1
$$;

-- 1) Learner: Next-Best-Skill-Actions
CREATE OR REPLACE FUNCTION public.learner_get_next_best_skill_actions(p_limit int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_items jsonb; v_reason text; v_returned int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  WITH weak AS (
    SELECT lcs.competency_id, lcs.mastery_score
      FROM public.learner_competency_state lcs
     WHERE lcs.user_id = v_uid AND COALESCE(lcs.mastery_score,0) < 0.65
     ORDER BY COALESCE(lcs.mastery_score,0) ASC LIMIT 15
  ),
  weak_nodes AS (SELECT w.*, fn_bki_node_for_competency(w.competency_id) AS comp_node_id FROM weak w),
  actions AS (
    SELECT wn.competency_id, wn.mastery_score,
           e.edge_type::text AS via_edge, n.id AS action_node_id,
           n.node_type::text AS action_type, n.title AS action_title,
           n.description AS action_description, e.confidence_score AS edge_confidence,
           cn.title AS competency_title
      FROM weak_nodes wn
      JOIN public.berufs_ki_graph_nodes cn ON cn.id = wn.comp_node_id
      JOIN public.berufs_ki_graph_edges e
        ON (e.from_node_id = wn.comp_node_id OR e.to_node_id = wn.comp_node_id)
       AND e.status='active'
      JOIN public.berufs_ki_graph_nodes n
        ON n.id = CASE WHEN e.from_node_id = wn.comp_node_id THEN e.to_node_id ELSE e.from_node_id END
       AND n.status='active' AND n.node_type IN ('lesson','recovery_action','workflow','blueprint')
     WHERE e.edge_type IN ('trains','recovers','assesses','strengthens')
  )
  SELECT COALESCE(jsonb_agg(a ORDER BY a.mastery_score ASC, a.edge_confidence DESC), '[]'::jsonb)
    INTO v_items FROM (
      SELECT DISTINCT ON (action_node_id) * FROM actions
       ORDER BY action_node_id, mastery_score ASC, edge_confidence DESC LIMIT p_limit
    ) a;

  v_returned := jsonb_array_length(v_items);
  v_reason := CASE
    WHEN NOT EXISTS (SELECT 1 FROM learner_competency_state WHERE user_id = v_uid) THEN 'NO_LEARNER_STATE'
    WHEN NOT EXISTS (SELECT 1 FROM berufs_ki_graph_edges WHERE status='active') THEN 'GRAPH_NOT_POPULATED'
    WHEN v_returned = 0 THEN 'NO_GRAPH_LINKED_WEAK_COMPETENCIES'
    ELSE 'OK'
  END;

  PERFORM public.fn_emit_audit('graph_activation_learner_skill_query',
    jsonb_build_object('user_id',v_uid,'returned',v_returned,'reason',v_reason));
  RETURN jsonb_build_object('reason',v_reason,'items',v_items,'returned',v_returned);
END $$;
REVOKE ALL ON FUNCTION public.learner_get_next_best_skill_actions(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_get_next_best_skill_actions(int) TO authenticated;

-- 2) Tutor: Graph Context
CREATE OR REPLACE FUNCTION public.tutor_get_graph_context(
  p_competency_id uuid DEFAULT NULL, p_lesson_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_node_id uuid; v_scope_label text;
        v_chain jsonb; v_evidence jsonb; v_reason text; v_returned int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_competency_id IS NOT NULL THEN
    v_node_id := fn_bki_node_for_competency(p_competency_id);
    v_scope_label := 'competency:'||p_competency_id::text;
  ELSIF p_lesson_id IS NOT NULL THEN
    SELECT id INTO v_node_id FROM berufs_ki_graph_nodes
     WHERE node_type='lesson' AND status='active' AND source_ref_id = p_lesson_id LIMIT 1;
    v_scope_label := 'lesson:'||p_lesson_id::text;
  ELSE RAISE EXCEPTION 'either_competency_or_lesson_required'; END IF;

  IF v_node_id IS NULL THEN
    v_reason := 'NO_GRAPH_NODE_FOR_SCOPE'; v_chain := '[]'::jsonb; v_evidence := '[]'::jsonb;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'edge_id',e.id,'edge_type',e.edge_type,'confidence',e.confidence_score,
        'neighbor_id',n.id,'neighbor_type',n.node_type,'neighbor_title',n.title
      ) ORDER BY e.confidence_score DESC), '[]'::jsonb)
      INTO v_chain
      FROM berufs_ki_graph_edges e
      JOIN berufs_ki_graph_nodes n
        ON n.id = CASE WHEN e.from_node_id = v_node_id THEN e.to_node_id ELSE e.from_node_id END
       AND n.status='active'
     WHERE (e.from_node_id = v_node_id OR e.to_node_id = v_node_id) AND e.status='active';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',ev.id,'edge_id',ev.edge_id,'evidence_type',ev.evidence_type,
        'source_table',ev.source_table,'confidence',ev.confidence)), '[]'::jsonb)
      INTO v_evidence
      FROM berufs_ki_graph_evidence ev
      JOIN berufs_ki_graph_edges e ON e.id = ev.edge_id
     WHERE (e.from_node_id = v_node_id OR e.to_node_id = v_node_id) AND e.status='active';

    v_returned := jsonb_array_length(v_chain);
    v_reason := CASE WHEN v_returned = 0 THEN 'NO_GRAPH_EVIDENCE' ELSE 'OK' END;
  END IF;

  PERFORM public.fn_emit_audit('graph_activation_tutor_context_query',
    jsonb_build_object('user_id',v_uid,'scope_node',v_scope_label,'returned',v_returned,'reason',v_reason));
  RETURN jsonb_build_object('reason',v_reason,'scope',v_scope_label,'node_id',v_node_id,
    'chain',v_chain,'evidence',v_evidence);
END $$;
REVOKE ALL ON FUNCTION public.tutor_get_graph_context(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_get_graph_context(uuid,uuid) TO authenticated;

-- 3) Learner: Workflow Recommendations
CREATE OR REPLACE FUNCTION public.learner_get_graph_workflow_recommendations(p_limit int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_items jsonb; v_reason text; v_returned int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  WITH weak AS (
    SELECT competency_id, mastery_score FROM public.learner_competency_state
     WHERE user_id = v_uid AND COALESCE(mastery_score,0) < 0.7 LIMIT 20
  ),
  weak_nodes AS (SELECT w.*, fn_bki_node_for_competency(w.competency_id) AS comp_node_id FROM weak w),
  recos AS (
    SELECT DISTINCT ON (wf.id)
      wf.id AS workflow_node_id, wf.title AS workflow_title,
      wf.description AS workflow_description, wf.source_ref_id AS workflow_id,
      e.edge_type::text AS via_edge, e.confidence_score AS edge_confidence, wn.mastery_score
    FROM weak_nodes wn
    JOIN public.berufs_ki_graph_edges e
      ON (e.from_node_id = wn.comp_node_id OR e.to_node_id = wn.comp_node_id)
     AND e.status='active' AND e.edge_type IN ('trains','strengthens','produces')
    JOIN public.berufs_ki_graph_nodes wf
      ON wf.id = CASE WHEN e.from_node_id = wn.comp_node_id THEN e.to_node_id ELSE e.from_node_id END
     AND wf.node_type='workflow' AND wf.status='active'
    ORDER BY wf.id, wn.mastery_score ASC, e.confidence_score DESC
  )
  SELECT COALESCE(jsonb_agg(r ORDER BY r.mastery_score ASC, r.edge_confidence DESC), '[]'::jsonb)
    INTO v_items FROM (SELECT * FROM recos LIMIT p_limit) r;

  v_returned := jsonb_array_length(v_items);
  v_reason := CASE
    WHEN NOT EXISTS (SELECT 1 FROM learner_competency_state WHERE user_id = v_uid) THEN 'NO_LEARNER_STATE'
    WHEN NOT EXISTS (SELECT 1 FROM berufs_ki_graph_edges WHERE status='active') THEN 'GRAPH_NOT_POPULATED'
    WHEN v_returned = 0 THEN 'NO_GRAPH_LINKED_WORKFLOWS'
    ELSE 'OK' END;

  PERFORM public.fn_emit_audit('graph_activation_workflow_reco_query',
    jsonb_build_object('user_id',v_uid,'returned',v_returned,'reason',v_reason));
  RETURN jsonb_build_object('reason',v_reason,'items',v_items,'returned',v_returned);
END $$;
REVOKE ALL ON FUNCTION public.learner_get_graph_workflow_recommendations(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_get_graph_workflow_recommendations(int) TO authenticated;

-- 4) Manager: Risk Explanations (scope-gated)
CREATE OR REPLACE FUNCTION public.manager_get_graph_risk_explanations(p_window_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_user_ids uuid[];
        v_items jsonb; v_reason text; v_returned int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT (has_role(v_uid,'admin'::app_role) OR has_role(v_uid,'owner'::app_role)
       OR has_role(v_uid,'org_admin'::app_role) OR has_role(v_uid,'org_owner'::app_role)
       OR has_role(v_uid,'org_manager'::app_role)) THEN
    RAISE EXCEPTION 'forbidden'; END IF;

  BEGIN
    SELECT array_agg(uid) INTO v_user_ids FROM public.fn_org_visible_user_ids(v_uid) AS uid;
  EXCEPTION WHEN undefined_function THEN v_user_ids := ARRAY[v_uid]; END;
  IF v_user_ids IS NULL OR array_length(v_user_ids,1) IS NULL THEN v_user_ids := ARRAY[v_uid]; END IF;

  WITH risk_comp AS (
    SELECT lcs.competency_id, COUNT(*) AS learners_affected,
           ROUND(AVG(lcs.mastery_score)::numeric, 3) AS avg_mastery
      FROM public.learner_competency_state lcs
     WHERE lcs.user_id = ANY(v_user_ids)
       AND COALESCE(lcs.mastery_score,0) < 0.6
       AND COALESCE(lcs.updated_at, lcs.created_at) > now() - make_interval(days => p_window_days)
     GROUP BY lcs.competency_id ORDER BY learners_affected DESC, avg_mastery ASC LIMIT 20
  ),
  risk_nodes AS (SELECT r.*, fn_bki_node_for_competency(r.competency_id) AS comp_node_id FROM risk_comp r),
  with_recovery AS (
    SELECT rn.competency_id, rn.learners_affected, rn.avg_mastery, cn.title AS competency_title,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'action_id',ra.id,'title',ra.title,
                      'edge_type',e.edge_type,'confidence',e.confidence_score
                    ) ORDER BY e.confidence_score DESC)
               FROM berufs_ki_graph_edges e
               JOIN berufs_ki_graph_nodes ra
                 ON ra.id = CASE WHEN e.from_node_id = rn.comp_node_id THEN e.to_node_id ELSE e.from_node_id END
                AND ra.status='active'
                AND ra.node_type IN ('recovery_action','workflow','lesson')
              WHERE (e.from_node_id = rn.comp_node_id OR e.to_node_id = rn.comp_node_id)
                AND e.status='active' AND e.edge_type IN ('recovers','strengthens','trains')
           ), '[]'::jsonb) AS suggested_actions
      FROM risk_nodes rn
      LEFT JOIN berufs_ki_graph_nodes cn ON cn.id = rn.comp_node_id
  )
  SELECT COALESCE(jsonb_agg(w ORDER BY w.learners_affected DESC, w.avg_mastery ASC), '[]'::jsonb)
    INTO v_items FROM with_recovery w;

  v_returned := jsonb_array_length(v_items);
  v_reason := CASE WHEN v_returned = 0 THEN 'NO_AT_RISK_COMPETENCIES_IN_WINDOW' ELSE 'OK' END;

  PERFORM public.fn_emit_audit('graph_activation_manager_risk_explain',
    jsonb_build_object('user_id',v_uid,'window_days',p_window_days,
      'returned',v_returned,'reason',v_reason,
      'scope_size',COALESCE(array_length(v_user_ids,1),0)));
  RETURN jsonb_build_object('reason',v_reason,'items',v_items,'returned',v_returned);
END $$;
REVOKE ALL ON FUNCTION public.manager_get_graph_risk_explanations(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_get_graph_risk_explanations(int) TO authenticated;

-- 5) ExamFit Bridge
CREATE OR REPLACE FUNCTION public.learner_get_examfit_graph_bridge(p_certification_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_cert_node uuid;
        v_items jsonb; v_reason text; v_returned int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_certification_id IS NULL THEN RAISE EXCEPTION 'certification_id_required'; END IF;

  SELECT id INTO v_cert_node FROM berufs_ki_graph_nodes
   WHERE node_type='certification' AND status='active' AND source_ref_id = p_certification_id LIMIT 1;

  IF v_cert_node IS NULL THEN
    v_reason := 'NO_CERTIFICATION_NODE'; v_items := '[]'::jsonb;
  ELSE
    WITH cert_comps AS (
      SELECT DISTINCT n.id AS comp_node_id, n.source_ref_id AS competency_id, n.title
        FROM berufs_ki_graph_edges e
        JOIN berufs_ki_graph_nodes n
          ON n.id = CASE WHEN e.from_node_id = v_cert_node THEN e.to_node_id ELSE e.from_node_id END
         AND n.node_type='competency' AND n.status='active'
       WHERE (e.from_node_id = v_cert_node OR e.to_node_id = v_cert_node) AND e.status='active'
    ),
    learner_gap AS (
      SELECT cc.comp_node_id, cc.competency_id, cc.title,
             COALESCE(lcs.mastery_score,0) AS mastery,
             COALESCE(lcs.exam_readiness,0) AS readiness,
             (1 - COALESCE(lcs.mastery_score,0)) AS gap
        FROM cert_comps cc
        LEFT JOIN learner_competency_state lcs
          ON lcs.user_id = v_uid AND lcs.competency_id = cc.competency_id
    ),
    with_blueprints AS (
      SELECT lg.*, COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'blueprint_node',bp.id,'blueprint_id',bp.source_ref_id,
                 'title',bp.title,'edge_type',e.edge_type
               ) ORDER BY e.confidence_score DESC)
          FROM berufs_ki_graph_edges e
          JOIN berufs_ki_graph_nodes bp
            ON bp.id = CASE WHEN e.from_node_id = lg.comp_node_id THEN e.to_node_id ELSE e.from_node_id END
           AND bp.node_type='blueprint' AND bp.status='active'
         WHERE (e.from_node_id = lg.comp_node_id OR e.to_node_id = lg.comp_node_id)
           AND e.status='active' AND e.edge_type IN ('assesses','trains')
      ), '[]'::jsonb) AS suggested_blueprints
      FROM learner_gap lg
    )
    SELECT COALESCE(jsonb_agg(wb ORDER BY wb.gap DESC), '[]'::jsonb)
      INTO v_items FROM with_blueprints wb;

    v_returned := jsonb_array_length(v_items);
    v_reason := CASE WHEN v_returned = 0 THEN 'NO_GRAPH_LINKED_COMPETENCIES' ELSE 'OK' END;
  END IF;

  PERFORM public.fn_emit_audit('graph_activation_examfit_bridge_query',
    jsonb_build_object('user_id',v_uid,'certification_id',p_certification_id,
      'returned',v_returned,'reason',v_reason));
  RETURN jsonb_build_object('reason',v_reason,'items',v_items,'returned',v_returned);
END $$;
REVOKE ALL ON FUNCTION public.learner_get_examfit_graph_bridge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_get_examfit_graph_bridge(uuid) TO authenticated;
