-- Move extensions from public to extensions schema (Supabase best practice)
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION unaccent SET SCHEMA extensions;