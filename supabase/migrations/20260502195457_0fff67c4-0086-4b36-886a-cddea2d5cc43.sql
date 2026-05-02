-- Path E G7: Allow anon/authenticated SELECT on v_data_holes_ssot
-- (aggregated counts only, no PII). Used by Conversion-Integrity Suite.
GRANT SELECT ON public.v_data_holes_ssot TO anon, authenticated;