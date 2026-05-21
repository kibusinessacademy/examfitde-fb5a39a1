
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
  SELECT p.state, p.pattern, p.redirect_to INTO v_policy_state, v_pattern, v_redirect
  FROM public.route_crawl_policy p WHERE p.match_type='exact' AND p.pattern = _path LIMIT 1;
  IF v_policy_state IS NULL THEN
    SELECT p.state, p.pattern, p.redirect_to INTO v_policy_state, v_pattern, v_redirect
    FROM public.route_crawl_policy p
    WHERE p.match_type='prefix' AND _path LIKE p.pattern || '%'
    ORDER BY length(p.pattern) DESC LIMIT 1;
  END IF;
  IF v_policy_state IS NULL THEN
    SELECT p.state, p.pattern, p.redirect_to INTO v_policy_state, v_pattern, v_redirect
    FROM public.route_crawl_policy p WHERE p.match_type='regex' AND _path ~ p.pattern LIMIT 1;
  END IF;

  v_in_sm := public.fn_path_in_sitemap(_path);

  IF v_status ~ 'soft.?404' THEN
    v_dec := 'soft404_candidate'; v_action := 'fix_thin_content_or_render';
  ELSIF v_status ~ '(404|not.?found)' THEN
    IF v_policy_state = 'gone' THEN v_dec := 'expected_gone'; v_action := 'noop';
    ELSIF v_policy_state = 'redirect' THEN v_dec := 'expected_redirect'; v_action := 'noop';
    ELSE v_dec := 'unexpected_404'; v_action := 'fix_route_or_add_redirect'; END IF;
  ELSIF v_status ~ '(redirect|page_with_redirect)' THEN
    IF v_policy_state = 'redirect' THEN v_dec := 'expected_redirect'; v_action := 'noop';
    ELSE v_dec := 'canonical_mismatch'; v_action := 'review_canonical_or_policy'; END IF;
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

  decision := v_dec; matched_pattern := v_pattern; matched_state := v_policy_state;
  redirect_to := v_redirect; in_sitemap := v_in_sm; expected_action := v_action;
  RETURN NEXT;
END $$;
