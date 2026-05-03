-- Helper RPC for hourly hard-block count probe (used by hard-block-debug-issue workflow).
CREATE OR REPLACE FUNCTION public.admin_count_hard_blocks_24h()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.auto_heal_log
  WHERE created_at > now() - interval '24 hours'
    AND action_type = 'hard_block_building_to_queued';
$$;

REVOKE ALL ON FUNCTION public.admin_count_hard_blocks_24h() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_count_hard_blocks_24h() TO service_role;