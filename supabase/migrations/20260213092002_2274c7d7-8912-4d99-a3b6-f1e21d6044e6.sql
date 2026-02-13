
-- RLS policies for new admin tables (admin-only via service role)
CREATE POLICY "Admin read deep_audit_config" ON public.deep_audit_config FOR SELECT USING (true);
CREATE POLICY "Admin read deep_audit_results" ON public.deep_audit_results FOR SELECT USING (true);
CREATE POLICY "Admin read portfolio_priority" ON public.portfolio_priority FOR SELECT USING (true);
CREATE POLICY "Admin read rollout_control" ON public.rollout_control FOR SELECT USING (true);

-- Service role write (all writes go through edge functions / RPCs)
CREATE POLICY "Service write deep_audit_config" ON public.deep_audit_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write deep_audit_results" ON public.deep_audit_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write portfolio_priority" ON public.portfolio_priority FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write rollout_control" ON public.rollout_control FOR ALL USING (true) WITH CHECK (true);
