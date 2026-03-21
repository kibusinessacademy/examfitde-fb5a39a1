
-- Force PostgREST schema cache reload after view changes
NOTIFY pgrst, 'reload schema';
