-- Force PostgREST schema cache reload to pick up renamed columns in v_admin_queue_ssot
NOTIFY pgrst, 'reload schema';