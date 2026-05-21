
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.gsc_reconciliation_decision'::regtype AND enumlabel='valid_indexable') THEN
    ALTER TYPE public.gsc_reconciliation_decision ADD VALUE 'valid_indexable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.gsc_reconciliation_decision'::regtype AND enumlabel='expected_gone') THEN
    ALTER TYPE public.gsc_reconciliation_decision ADD VALUE 'expected_gone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.gsc_reconciliation_decision'::regtype AND enumlabel='missing_from_sitemap') THEN
    ALTER TYPE public.gsc_reconciliation_decision ADD VALUE 'missing_from_sitemap';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.gsc_reconciliation_decision'::regtype AND enumlabel='unexpected_404') THEN
    ALTER TYPE public.gsc_reconciliation_decision ADD VALUE 'unexpected_404';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.gsc_reconciliation_decision'::regtype AND enumlabel='soft404_candidate') THEN
    ALTER TYPE public.gsc_reconciliation_decision ADD VALUE 'soft404_candidate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.gsc_reconciliation_decision'::regtype AND enumlabel='canonical_mismatch') THEN
    ALTER TYPE public.gsc_reconciliation_decision ADD VALUE 'canonical_mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.gsc_reconciliation_decision'::regtype AND enumlabel='blocked_by_policy') THEN
    ALTER TYPE public.gsc_reconciliation_decision ADD VALUE 'blocked_by_policy';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_path_in_sitemap(_path text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p text := COALESCE(_path, '');
  v_slug text;
BEGIN
  IF p = '' OR p = '/' THEN RETURN TRUE; END IF;

  IF p LIKE '/paket/%' THEN
    v_slug := split_part(trim(both '/' from substring(p from 8)), '/', 1);
    RETURN EXISTS (SELECT 1 FROM public.v_paket_sitemap_entries e WHERE e.slug = v_slug);
  END IF;

  IF p LIKE '/blog/%' THEN
    v_slug := split_part(trim(both '/' from substring(p from 7)), '/', 1);
    RETURN EXISTS (SELECT 1 FROM public.v_blog_sitemap_entries e WHERE e.slug = v_slug);
  END IF;

  IF p LIKE '/wissen/%' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.v_wissen_sitemap_entries v
      WHERE ('/wissen/' || trim(both '/' from v.path)) = rtrim(p, '/')
         OR v.path = p
    );
  END IF;

  IF p LIKE '/pruefungstraining/%' THEN
    v_slug := split_part(trim(both '/' from substring(p from 19)), '/', 1);
    RETURN EXISTS (SELECT 1 FROM public.v_pruefungstraining_sitemap_entries e WHERE e.slug = v_slug);
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.route_crawl_policy
    WHERE match_type='exact' AND state='index' AND pattern = p
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_path_in_sitemap(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_path_in_sitemap(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_classify_gsc_url_v2(_path text, _gsc_status text)
RETURNS TABLE(
  decision public.gsc_reconciliation_decision,
  matched_pattern text,
  matched_state public.route_crawl_state,
  redirect_to text,
  in_sitemap boolean,
  expected_action text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_policy_state public.route_crawl_state;
  v_pattern text;
  v_redirect text;
  v_in_sm boolean;
  v_status text := lower(coalesce(_gsc_status, ''));
  v_dec public.gsc_reconciliation_decision;
  v_action text;
BEGIN
  SELECT state, pattern, redirect_to INTO v_policy_state, v_pattern, v_redirect
  FROM public.route_crawl_policy WHERE match_type='exact' AND pattern = _path LIMIT 1;

  IF v_policy_state IS NULL THEN
    SELECT state, pattern, redirect_to INTO v_policy_state, v_pattern, v_redirect
    FROM public.route_crawl_policy
    WHERE match_type='prefix' AND _path LIKE pattern || '%'
    ORDER BY length(pattern) DESC LIMIT 1;
  END IF;

  IF v_policy_state IS NULL THEN
    SELECT state, pattern, redirect_to INTO v_policy_state, v_pattern, v_redirect
    FROM public.route_crawl_policy WHERE match_type='regex' AND _path ~ pattern LIMIT 1;
  END IF;

  v_in_sm := public.fn_path_in_sitemap(_path);

  IF v_status ~ '(404|not.?found)' THEN
    IF v_policy_state = 'gone' THEN v_dec := 'expected_gone'; v_action := 'noop';
    ELSIF v_policy_state = 'redirect' THEN v_dec := 'expected_redirect'; v_action := 'noop';
    ELSE v_dec := 'unexpected_404'; v_action := 'fix_route_or_add_redirect'; END IF;
  ELSIF v_status ~ '(redirect|page_with_redirect)' THEN
    IF v_policy_state = 'redirect' THEN v_dec := 'expected_redirect'; v_action := 'noop';
    ELSE v_dec := 'canonical_mismatch'; v_action := 'review_canonical_or_policy'; END IF;
  ELSIF v_status ~ 'soft.?404' THEN
    v_dec := 'soft404_candidate'; v_action := 'fix_thin_content_or_render';
  ELSIF v_status ~ 'noindex' THEN
    IF v_policy_state = 'noindex' THEN v_dec := 'expected_noindex'; v_action := 'noop';
    ELSE v_dec := 'blocked_by_policy'; v_action := 'remove_noindex_or_align_policy'; END IF;
  ELSIF v_status ~ '(canonical|alternate|duplicate)' THEN
    v_dec := 'canonical_mismatch'; v_action := 'fix_canonical_target';
  ELSIF v_status ~ '(indexed|valid|submitted_and_indexed)' THEN
    IF coalesce(v_policy_state,'index') = 'index' AND v_in_sm THEN
      v_dec := 'valid_indexable'; v_action := 'noop';
    ELSIF coalesce(v_policy_state,'index') = 'index' AND NOT v_in_sm THEN
      v_dec := 'missing_from_sitemap'; v_action := 'add_to_sitemap_or_check_publish_state';
    ELSE v_dec := 'blocked_by_policy'; v_action := 'policy_disagrees_with_index'; END IF;
  ELSE
    IF v_policy_state = 'noindex' THEN v_dec := 'expected_noindex'; v_action := 'noop';
    ELSIF v_policy_state = 'redirect' THEN v_dec := 'expected_redirect'; v_action := 'noop';
    ELSIF v_policy_state = 'gone' THEN v_dec := 'expected_gone'; v_action := 'noop';
    ELSIF coalesce(v_policy_state,'index') = 'index' AND v_in_sm THEN
      v_dec := 'valid_indexable'; v_action := 'noop';
    ELSIF coalesce(v_policy_state,'index') = 'index' AND NOT v_in_sm THEN
      v_dec := 'missing_from_sitemap'; v_action := 'add_to_sitemap_or_check_publish_state';
    ELSE v_dec := 'unclassified_needs_fix'; v_action := 'manual_review'; END IF;
  END IF;

  decision := v_dec;
  matched_pattern := v_pattern;
  matched_state := v_policy_state;
  redirect_to := v_redirect;
  in_sitemap := v_in_sm;
  expected_action := v_action;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.fn_classify_gsc_url_v2(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_classify_gsc_url_v2(text,text) TO service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('gsc_reconciliation_run', ARRAY['input_count','summary'], 'seo')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys;

CREATE OR REPLACE FUNCTION public.admin_reconcile_gsc_urls(
  _inputs jsonb DEFAULT '[]'::jsonb,
  _source text DEFAULT 'manual_paste'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_row jsonb;
  v_input record;
  v_path text;
  v_cls record;
  v_input_count int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  IF _inputs IS NULL OR jsonb_typeof(_inputs) <> 'array' THEN
    RAISE EXCEPTION 'inputs must be a JSON array' USING ERRCODE = '22023';
  END IF;

  FOR v_input IN
    SELECT coalesce(elem->>'path', elem->>'url') AS raw,
           elem->>'gsc_status' AS gsc_status
    FROM jsonb_array_elements(_inputs) AS elem
  LOOP
    v_input_count := v_input_count + 1;
    IF v_input.raw IS NULL OR v_input.raw = '' THEN CONTINUE; END IF;

    v_path := v_input.raw;
    IF v_path ~ '^https?://' THEN
      v_path := regexp_replace(v_path, '^https?://[^/]+', '');
    END IF;
    IF v_path = '' THEN v_path := '/'; END IF;
    v_path := regexp_replace(v_path, '\?.*$', '');
    v_path := regexp_replace(v_path, '#.*$', '');

    SELECT * INTO v_cls FROM public.fn_classify_gsc_url_v2(v_path, v_input.gsc_status);

    v_row := jsonb_build_object(
      'input', v_input.raw,
      'path', v_path,
      'gsc_status', v_input.gsc_status,
      'decision', v_cls.decision,
      'expected_action', v_cls.expected_action,
      'matched_pattern', v_cls.matched_pattern,
      'matched_state', v_cls.matched_state,
      'redirect_to', v_cls.redirect_to,
      'in_sitemap', v_cls.in_sitemap
    );
    v_rows := v_rows || v_row;
  END LOOP;

  SELECT jsonb_object_agg(decision, cnt) INTO v_summary
  FROM (
    SELECT (r->>'decision') AS decision, count(*) AS cnt
    FROM jsonb_array_elements(v_rows) r GROUP BY 1
  ) s;

  PERFORM public.fn_emit_audit(
    'gsc_reconciliation_run',
    jsonb_build_object(
      'input_count', v_input_count,
      'summary', coalesce(v_summary, '{}'::jsonb),
      'source', _source
    ),
    NULL, 'system', 'ok'
  );

  RETURN jsonb_build_object(
    'input_count', v_input_count,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'rows', v_rows
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_reconcile_gsc_urls(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_gsc_urls(jsonb,text) TO authenticated;
