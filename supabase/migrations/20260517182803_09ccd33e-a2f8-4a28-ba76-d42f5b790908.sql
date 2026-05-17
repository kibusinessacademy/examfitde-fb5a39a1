
INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module) VALUES
  ('blog_publish_canonical_repair_detected', ARRAY['correlation_id','phase','detected_count'], 'seo_blog_publish'),
  ('blog_publish_canonical_repair_applied',  ARRAY['correlation_id','phase','applied_count'],  'seo_blog_publish'),
  ('blog_publish_canonical_repair_summary',  ARRAY['correlation_id','phase','detected','applied'], 'seo_blog_publish')
ON CONFLICT (action_type) DO NOTHING;
