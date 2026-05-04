
CREATE OR REPLACE FUNCTION public.get_table_columns(p_schema text, p_table text)
RETURNS TABLE(column_name text, data_type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.column_name::text, c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_schema = p_schema AND c.table_name = p_table
  ORDER BY c.ordinal_position;
$$;
REVOKE ALL ON FUNCTION public.get_table_columns(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_table_columns(text,text) TO service_role;
