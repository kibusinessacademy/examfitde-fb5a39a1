
UPDATE public.course_packages
SET status = 'blocked',
    blocked_reason = 'content_gap',
    blocked_at = now(),
    stuck_reason = 'multi_heal_p4_groupC: 0 approved questions — manual content regen required'
WHERE id IN ('21f0b991-17ef-49a7-96fb-71e076a74e7d','d1336c74-952a-4b06-8f4d-2fb826346b77');

INSERT INTO public.admin_actions (action, scope, payload, user_id)
VALUES ('multi_heal_p4_done', '9_packages',
  jsonb_build_object(
    'published', '1f3fe84a',
    'reconciled_release_block', ARRAY['2378b40e','348c9ef9','65430b12','d7fd81c3','ba96f6d9','d2000000-0010'],
    'blocked_content_gap', ARRAY['21f0b991','d1336c74']
  ), NULL);
