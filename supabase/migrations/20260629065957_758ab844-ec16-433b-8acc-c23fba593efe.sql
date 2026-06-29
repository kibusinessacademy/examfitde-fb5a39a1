
ALTER TABLE public.beruf_image_cache
  ADD COLUMN IF NOT EXISTS scene_id text,
  ADD COLUMN IF NOT EXISTS scene_subject text,
  ADD COLUMN IF NOT EXISTS scene_setting text,
  ADD COLUMN IF NOT EXISTS scene_action text,
  ADD COLUMN IF NOT EXISTS prompt_text text,
  ADD COLUMN IF NOT EXISTS alt_text text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS beruf_image_cache_scene_id_idx ON public.beruf_image_cache(scene_id);
