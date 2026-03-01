-- Add unique constraint for beruf_id + tier to enable upsert
ALTER TABLE public.berufski_produkte
ADD CONSTRAINT berufski_produkte_beruf_tier_unique UNIQUE (beruf_id, tier);
