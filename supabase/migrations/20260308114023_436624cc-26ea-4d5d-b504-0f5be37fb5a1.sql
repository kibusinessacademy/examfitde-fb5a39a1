
ALTER TABLE public.qualification_wave_candidates
  ADD CONSTRAINT qualification_wave_candidates_catalog_id_unique
  UNIQUE (qualification_catalog_id);
