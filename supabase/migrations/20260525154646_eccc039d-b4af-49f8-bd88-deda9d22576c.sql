-- 1) Payment bypass fix: lock down work_purchases INSERT to service_role only
DROP POLICY IF EXISTS "Service can insert purchases" ON public.work_purchases;

CREATE POLICY "Service role can insert purchases"
ON public.work_purchases
FOR INSERT
TO service_role
WITH CHECK (true);

-- Defense in depth: block any client (anon/authenticated) from inserting,
-- even if a future permissive policy is added.
REVOKE INSERT ON public.work_purchases FROM anon, authenticated;

-- 2) Exposed AI system prompts fix: revoke column-level SELECT on sensitive columns
-- The row-level public read policy stays in place (clients only query non-sensitive cols),
-- but Postgres column privileges now hard-block reads of the prompt columns from anon/authenticated.
REVOKE SELECT (system_prompt, user_prompt_template)
  ON public.berufs_ki_workflow_definitions
  FROM anon, authenticated;
