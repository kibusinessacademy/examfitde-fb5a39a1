
SELECT set_config('council.publish_bypass', 'true', true);

SELECT public.pipeline_write_lesson_content(
  'ff9a091d-80db-4bc9-b794-b986abec3c79'::uuid,
  '{"html":"<p>[Re-Gen: akademisches Profil]</p>","_placeholder":true}'::jsonb
);
SELECT public.pipeline_write_lesson_content(
  '6ad19e51-11db-4af0-a412-24045089e0dc'::uuid,
  '{"html":"<p>[Re-Gen: akademisches Profil]</p>","_placeholder":true}'::jsonb
);
SELECT public.pipeline_write_lesson_content(
  '19ea990a-62ce-4cbd-8e04-f5b37dd64004'::uuid,
  '{"html":"<p>[Re-Gen: akademisches Profil]</p>","_placeholder":true}'::jsonb
);
SELECT public.pipeline_write_lesson_content(
  'ab1368ec-4289-4563-8ecf-373e066a7231'::uuid,
  '{"html":"<p>[Re-Gen: akademisches Profil]</p>","_placeholder":true}'::jsonb
);
SELECT public.pipeline_write_lesson_content(
  'f280c62f-00ad-440e-bfd2-92c278f68475'::uuid,
  '{"html":"<p>[Re-Gen: akademisches Profil]</p>","_placeholder":true}'::jsonb
);
SELECT public.pipeline_write_lesson_content(
  'eb868afb-bdaa-400d-b249-b1ab03b8b02f'::uuid,
  '{"html":"<p>[Re-Gen: akademisches Profil]</p>","_placeholder":true}'::jsonb
);
SELECT public.pipeline_write_lesson_content(
  '8bce82b0-b345-476d-8405-ab6cb18477f1'::uuid,
  '{"html":"<p>[Re-Gen: akademisches Profil]</p>","_placeholder":true}'::jsonb
);
