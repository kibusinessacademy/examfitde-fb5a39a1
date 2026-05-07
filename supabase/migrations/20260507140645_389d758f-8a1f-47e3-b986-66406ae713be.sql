CREATE OR REPLACE FUNCTION public.admin_apply_content_graph_edges(
  p_edges jsonb,
  p_reason text,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count int;
  v_inserted int := 0;
  v_skipped int := 0;
  v_would_insert int := 0;
  v_would_skip int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  e jsonb;
  v_from uuid;
  v_to uuid;
  v_type text;
  v_exists_from boolean;
  v_exists_to boolean;
  v_exists_edge boolean;
  v_was_inserted boolean;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason required (min 3 chars)';
  END IF;

  IF jsonb_typeof(p_edges) <> 'array' THEN
    RAISE EXCEPTION 'p_edges must be a jsonb array';
  END IF;

  v_count := jsonb_array_length(p_edges);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'p_edges is empty';
  END IF;
  IF v_count > 25 THEN
    RAISE EXCEPTION 'max 25 edges per run (got %)', v_count;
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_edges)
  LOOP
    BEGIN
      v_from := (e->>'from_node_id')::uuid;
      v_to := (e->>'to_node_id')::uuid;
      v_type := e->>'edge_type';

      IF v_type NOT IN ('money_page', 'funnel_next') THEN
        v_errors := v_errors || jsonb_build_object('edge', e, 'error', 'invalid edge_type');
        CONTINUE;
      END IF;

      IF v_from IS NULL OR v_to IS NULL THEN
        v_errors := v_errors || jsonb_build_object('edge', e, 'error', 'missing from/to');
        CONTINUE;
      END IF;

      IF v_from = v_to THEN
        v_errors := v_errors || jsonb_build_object('edge', e, 'error', 'self loop');
        CONTINUE;
      END IF;

      SELECT EXISTS(SELECT 1 FROM growth_content_graph_nodes WHERE id = v_from) INTO v_exists_from;
      SELECT EXISTS(SELECT 1 FROM growth_content_graph_nodes WHERE id = v_to) INTO v_exists_to;
      IF NOT v_exists_from OR NOT v_exists_to THEN
        v_errors := v_errors || jsonb_build_object('edge', e, 'error', 'node missing');
        CONTINUE;
      END IF;

      IF p_dry_run THEN
        SELECT EXISTS(
          SELECT 1 FROM growth_content_graph_edges
          WHERE from_node_id = v_from AND to_node_id = v_to AND edge_type = v_type::growth_edge_type
        ) INTO v_exists_edge;

        IF v_exists_edge THEN
          v_would_skip := v_would_skip + 1;
          v_results := v_results || jsonb_build_object('edge', e, 'status', 'would_skip_existing');
        ELSE
          v_would_insert := v_would_insert + 1;
          v_results := v_results || jsonb_build_object('edge', e, 'status', 'would_insert');
        END IF;
      ELSE
        WITH ins AS (
          INSERT INTO growth_content_graph_edges (from_node_id, to_node_id, edge_type, priority, metadata, created_by)
          VALUES (
            v_from, v_to, v_type::growth_edge_type, 0,
            jsonb_build_object(
              'source', 'admin_apply_content_graph_edges',
              'confidence', e->>'confidence',
              'reason', e->>'reason',
              'applied_by', v_actor,
              'applied_at', now()
            ),
            v_actor
          )
          ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING
          RETURNING 1
        )
        SELECT EXISTS(SELECT 1 FROM ins) INTO v_was_inserted;

        IF v_was_inserted THEN
          v_inserted := v_inserted + 1;
          v_results := v_results || jsonb_build_object('edge', e, 'status', 'inserted');
        ELSE
          v_skipped := v_skipped + 1;
          v_results := v_results || jsonb_build_object('edge', e, 'status', 'skipped_exists');
        END IF;
      END IF;

    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('edge', e, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    CASE WHEN p_dry_run THEN 'growth_content_graph_apply_edges_dry_run' ELSE 'growth_content_graph_apply_edges' END,
    'system',
    NULL,
    CASE WHEN jsonb_array_length(v_errors) = 0 THEN 'success' ELSE 'partial' END,
    CASE
      WHEN p_dry_run THEN format('would_insert=%s would_skip=%s errors=%s', v_would_insert, v_would_skip, jsonb_array_length(v_errors))
      ELSE format('inserted=%s skipped=%s errors=%s', v_inserted, v_skipped, jsonb_array_length(v_errors))
    END,
    jsonb_build_object(
      'actor', v_actor,
      'reason', p_reason,
      'dry_run', p_dry_run,
      'requested', v_count,
      'inserted', v_inserted,
      'skipped', v_skipped,
      'would_insert', v_would_insert,
      'would_skip_existing', v_would_skip,
      'errors', v_errors
    )
  );

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'requested', v_count,
    'inserted', v_inserted,
    'skipped', v_skipped,
    'would_insert', v_would_insert,
    'would_skip_existing', v_would_skip,
    'errors_count', jsonb_array_length(v_errors),
    'errors', v_errors,
    'results', v_results,
    'reason', p_reason,
    'applied_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_content_graph_edges(jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_content_graph_edges(jsonb, text, boolean) TO authenticated, service_role;

-- Drop stale 2-arg overload (we now use the 3-arg version exclusively)
DROP FUNCTION IF EXISTS public.admin_apply_content_graph_edges(jsonb, text);