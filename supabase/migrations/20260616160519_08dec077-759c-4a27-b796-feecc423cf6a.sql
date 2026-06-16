
-- 1. berufs_ki_agents - restrict to admins
DROP POLICY IF EXISTS "agents_authenticated_read_active" ON public.berufs_ki_agents;
CREATE POLICY "agents_admin_read" ON public.berufs_ki_agents
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. berufs_ki_agent_orchestrations - restrict to admins
DROP POLICY IF EXISTS "orchestrations_authenticated_read_active" ON public.berufs_ki_agent_orchestrations;
CREATE POLICY "orchestrations_admin_read" ON public.berufs_ki_agent_orchestrations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. beruf_market_data - restrict to admins
DROP POLICY IF EXISTS "Authenticated users can read market data" ON public.beruf_market_data;
CREATE POLICY "market_data_admin_read" ON public.beruf_market_data
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4. dom_blueprint_* tables - restrict to admins
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dom_blueprints','dom_blueprint_parts','dom_blueprint_domains',
    'dom_blueprint_topics','dom_blueprint_subtopics',
    'dom_blueprint_type_mix','dom_blueprint_snapshots','dom_blueprint_coverage'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can read" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "dom_blueprint_admin_read" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'))$p$, t);
  END LOOP;
END $$;

-- 5. phantom_step_e2e_runs - restrict to admins
DROP POLICY IF EXISTS "Authenticated users can read" ON public.phantom_step_e2e_runs;
CREATE POLICY "phantom_step_e2e_runs_admin_read" ON public.phantom_step_e2e_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
