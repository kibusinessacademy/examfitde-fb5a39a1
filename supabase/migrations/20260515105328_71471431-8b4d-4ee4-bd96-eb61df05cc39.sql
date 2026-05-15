UPDATE public.seo_content_pages
SET sections_json = jsonb_set(
  sections_json,
  '{internal_links}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN (l->>'href') LIKE '/kurse/%' THEN l
        WHEN (l->>'href') LIKE '/%' THEN jsonb_set(l, '{href}', to_jsonb('/kurse' || (l->>'href')))
        ELSE l
      END
    )
    FROM jsonb_array_elements(sections_json->'internal_links') l
  )
),
last_generated_at = now()
WHERE id = '156fc345-7468-4709-8645-2ef569c0a9e4'
  AND sections_json ? 'internal_links';

INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
VALUES ('pillar_internal_links_href_backfill', 'seo_content_pages',
  '156fc345-7468-4709-8645-2ef569c0a9e4', 'ok',
  jsonb_build_object('note', 'AEVO pillar internal_links rewritten to /kurse/<slug>', 'at', now()));