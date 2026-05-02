-- Rename enum value to align DB with frontend whitelist (azubi|betrieb|institution)
ALTER TYPE public.product_persona RENAME VALUE 'umschulung' TO 'institution';