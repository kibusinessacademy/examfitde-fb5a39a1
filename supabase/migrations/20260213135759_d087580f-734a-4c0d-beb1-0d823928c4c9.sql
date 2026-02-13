CREATE OR REPLACE FUNCTION public.compute_question_hash(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(public.normalize_question_text(p_text), 'sha256'), 'hex');
$$;