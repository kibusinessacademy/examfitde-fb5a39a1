
-- Cleanup: Drop any policies created by partial first migration, then recreate all
-- Use DROP IF EXISTS for every policy before CREATE

-- admin_search_index
DROP POLICY IF EXISTS "service_role_all" ON public.admin_search_index;
DROP POLICY IF EXISTS "admin_read_search" ON public.admin_search_index;
CREATE POLICY "service_role_all" ON public.admin_search_index FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_search" ON public.admin_search_index FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.api_rate_limits;
CREATE POLICY "service_role_all" ON public.api_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.asset_optimization_scores;
CREATE POLICY "service_role_all" ON public.asset_optimization_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.authority_decisions;
DROP POLICY IF EXISTS "admin_read_authority" ON public.authority_decisions;
CREATE POLICY "service_role_all" ON public.authority_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_authority" ON public.authority_decisions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all_bp" ON public.blog_posts;
DROP POLICY IF EXISTS "admin_manage_blog_posts" ON public.blog_posts;
CREATE POLICY "service_role_all_bp" ON public.blog_posts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_blog_posts" ON public.blog_posts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.campaign_asset_queue;
CREATE POLICY "service_role_all" ON public.campaign_asset_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.campaign_assets;
CREATE POLICY "service_role_all" ON public.campaign_assets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.campaign_automation_runs;
CREATE POLICY "service_role_all" ON public.campaign_automation_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.campaign_launch_plans;
CREATE POLICY "service_role_all" ON public.campaign_launch_plans FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.campaign_performance_snapshots;
CREATE POLICY "service_role_all" ON public.campaign_performance_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.canary_releases;
DROP POLICY IF EXISTS "admin_read_canary" ON public.canary_releases;
CREATE POLICY "service_role_all" ON public.canary_releases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_canary" ON public.canary_releases FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.ceo_daily_kpis;
DROP POLICY IF EXISTS "admin_read_ceo_kpis" ON public.ceo_daily_kpis;
CREATE POLICY "service_role_all" ON public.ceo_daily_kpis FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_ceo_kpis" ON public.ceo_daily_kpis FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.certification_dominance_snapshots;
CREATE POLICY "service_role_all" ON public.certification_dominance_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.channel_performance_profiles;
CREATE POLICY "service_role_all" ON public.channel_performance_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.cluster_dominance_snapshots;
CREATE POLICY "service_role_all" ON public.cluster_dominance_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_cps" ON public.competency_performance_stats;
DROP POLICY IF EXISTS "admin_read_competency_stats" ON public.competency_performance_stats;
CREATE POLICY "service_role_all_cps" ON public.competency_performance_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_competency_stats" ON public.competency_performance_stats FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all_ca" ON public.content_assets;
DROP POLICY IF EXISTS "admin_manage_content_assets" ON public.content_assets;
CREATE POLICY "service_role_all_ca" ON public.content_assets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_content_assets" ON public.content_assets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all_cp" ON public.content_pages;
DROP POLICY IF EXISTS "admin_manage_content_pages" ON public.content_pages;
CREATE POLICY "service_role_all_cp" ON public.content_pages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_content_pages" ON public.content_pages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.course_pipeline_events;
DROP POLICY IF EXISTS "admin_read_cpe" ON public.course_pipeline_events;
CREATE POLICY "service_role_all" ON public.course_pipeline_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_cpe" ON public.course_pipeline_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_gtm_scores;
CREATE POLICY "service_role_all" ON public.curriculum_gtm_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_launch_recommendations;
CREATE POLICY "service_role_all" ON public.curriculum_launch_recommendations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_revenue_runs;
CREATE POLICY "service_role_all" ON public.curriculum_revenue_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_revenue_signals;
CREATE POLICY "service_role_all" ON public.curriculum_revenue_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_scaling_signals;
CREATE POLICY "service_role_all" ON public.curriculum_scaling_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.deep_audit_config;
DROP POLICY IF EXISTS "admin_read_deep_audit_config" ON public.deep_audit_config;
CREATE POLICY "service_role_all" ON public.deep_audit_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_deep_audit_config" ON public.deep_audit_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.deep_audit_results;
DROP POLICY IF EXISTS "admin_read_deep_audit_results" ON public.deep_audit_results;
CREATE POLICY "service_role_all" ON public.deep_audit_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_deep_audit_results" ON public.deep_audit_results FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.difficulty_distribution_targets;
CREATE POLICY "service_role_all" ON public.difficulty_distribution_targets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.distribution_channel_configs;
CREATE POLICY "service_role_all" ON public.distribution_channel_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.distribution_delivery_logs;
CREATE POLICY "service_role_all" ON public.distribution_delivery_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.distribution_publications;
CREATE POLICY "service_role_all" ON public.distribution_publications FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.distribution_queue;
CREATE POLICY "service_role_all" ON public.distribution_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.distribution_runs;
CREATE POLICY "service_role_all" ON public.distribution_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.distribution_targets;
CREATE POLICY "service_role_all" ON public.distribution_targets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.dominance_control;
DROP POLICY IF EXISTS "admin_read_dominance" ON public.dominance_control;
CREATE POLICY "service_role_all" ON public.dominance_control FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_dominance" ON public.dominance_control FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.drift_snapshots;
DROP POLICY IF EXISTS "admin_read_drift" ON public.drift_snapshots;
CREATE POLICY "service_role_all" ON public.drift_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_drift" ON public.drift_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.exam_part_mappings;
CREATE POLICY "service_role_all" ON public.exam_part_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.exam_question_elite_annotations;
CREATE POLICY "service_role_all" ON public.exam_question_elite_annotations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.german_certification_master;
DROP POLICY IF EXISTS "admin_read_cert_master" ON public.german_certification_master;
DROP POLICY IF EXISTS "public_read_cert_master" ON public.german_certification_master;
CREATE POLICY "service_role_all" ON public.german_certification_master FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "public_read_cert_master" ON public.german_certification_master FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "service_role_all" ON public.golden_exam_sets;
CREATE POLICY "service_role_all" ON public.golden_exam_sets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.humor_asset_reviews;
CREATE POLICY "service_role_all" ON public.humor_asset_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.humor_generation_jobs;
CREATE POLICY "service_role_all" ON public.humor_generation_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.market_clusters;
CREATE POLICY "service_role_all" ON public.market_clusters FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.ops_alert_events;
DROP POLICY IF EXISTS "admin_read_alert_events" ON public.ops_alert_events;
CREATE POLICY "service_role_all" ON public.ops_alert_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_alert_events" ON public.ops_alert_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.optimization_actions;
CREATE POLICY "service_role_all" ON public.optimization_actions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.optimization_observations;
CREATE POLICY "service_role_all" ON public.optimization_observations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.optimization_runs;
CREATE POLICY "service_role_all" ON public.optimization_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.oral_exam_turns;
CREATE POLICY "service_role_all" ON public.oral_exam_turns FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_pqs" ON public.package_quality_summary;
DROP POLICY IF EXISTS "admin_read_pqs" ON public.package_quality_summary;
CREATE POLICY "service_role_all_pqs" ON public.package_quality_summary FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_pqs" ON public.package_quality_summary FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.pipeline_step_order;
CREATE POLICY "service_role_all" ON public.pipeline_step_order FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.portfolio_priority;
DROP POLICY IF EXISTS "admin_read_portfolio" ON public.portfolio_priority;
CREATE POLICY "service_role_all" ON public.portfolio_priority FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_portfolio" ON public.portfolio_priority FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.product_factory_specs;
CREATE POLICY "service_role_all" ON public.product_factory_specs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.products;
DROP POLICY IF EXISTS "public_read_products" ON public.products;
CREATE POLICY "service_role_all" ON public.products FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "public_read_products" ON public.products FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "service_role_all" ON public.profession_profiles;
CREATE POLICY "service_role_all" ON public.profession_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_write_disc" ON public.question_discrimination_stats;
CREATE POLICY "service_role_write_disc" ON public.question_discrimination_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_qqm" ON public.question_quality_metrics;
DROP POLICY IF EXISTS "admin_read_qqm" ON public.question_quality_metrics;
CREATE POLICY "service_role_all_qqm" ON public.question_quality_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_qqm" ON public.question_quality_metrics FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_write_qsm" ON public.question_skill_map;
CREATE POLICY "service_role_write_qsm" ON public.question_skill_map FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.question_variant_stats;
DROP POLICY IF EXISTS "admin_read_variant_stats" ON public.question_variant_stats;
CREATE POLICY "service_role_all" ON public.question_variant_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_variant_stats" ON public.question_variant_stats FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.rollout_control;
DROP POLICY IF EXISTS "admin_read_rollout" ON public.rollout_control;
CREATE POLICY "service_role_all" ON public.rollout_control FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_rollout" ON public.rollout_control FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all_sr" ON public.seo_redirects;
DROP POLICY IF EXISTS "admin_manage_redirects" ON public.seo_redirects;
DROP POLICY IF EXISTS "public_read_redirects" ON public.seo_redirects;
CREATE POLICY "service_role_all_sr" ON public.seo_redirects FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_redirects" ON public.seo_redirects FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "public_read_redirects" ON public.seo_redirects FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "service_role_write_skills" ON public.skill_nodes;
CREATE POLICY "service_role_write_skills" ON public.skill_nodes FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.standalone_artifact_versions;
CREATE POLICY "service_role_all" ON public.standalone_artifact_versions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.standalone_backup_targets;
CREATE POLICY "service_role_all" ON public.standalone_backup_targets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.standalone_backups;
CREATE POLICY "service_role_all" ON public.standalone_backups FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.standalone_license_devices;
CREATE POLICY "service_role_all" ON public.standalone_license_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.standalone_license_events;
CREATE POLICY "service_role_all" ON public.standalone_license_events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.standalone_licenses;
CREATE POLICY "service_role_all" ON public.standalone_licenses FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.standalone_restore_events;
CREATE POLICY "service_role_all" ON public.standalone_restore_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Additional fixes
DROP POLICY IF EXISTS "service_role_insert_backups" ON public.backup_snapshots;
CREATE POLICY "service_role_insert_backups" ON public.backup_snapshots FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_insert_concurrency" ON public.concurrency_snapshots;
CREATE POLICY "service_role_insert_concurrency" ON public.concurrency_snapshots FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_insert_dlq" ON public.exam_pool_dlq;
CREATE POLICY "service_role_insert_dlq" ON public.exam_pool_dlq FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_insert_feedback" ON public.exam_ai_feedback;
CREATE POLICY "service_role_insert_feedback" ON public.exam_ai_feedback FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_manage_outcomes" ON public.outcome_tracking;
CREATE POLICY "service_role_manage_outcomes" ON public.outcome_tracking FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.slo_metrics;
DROP POLICY IF EXISTS "admin_read_slo" ON public.slo_metrics;
CREATE POLICY "service_role_all" ON public.slo_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_slo" ON public.slo_metrics FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.quality_audit_snapshots;
DROP POLICY IF EXISTS "admin_read_qa_snapshots" ON public.quality_audit_snapshots;
CREATE POLICY "service_role_all" ON public.quality_audit_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_qa_snapshots" ON public.quality_audit_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.quality_score_versions;
DROP POLICY IF EXISTS "admin_read_qsv" ON public.quality_score_versions;
CREATE POLICY "service_role_all" ON public.quality_score_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_qsv" ON public.quality_score_versions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.package_quality_scores;
DROP POLICY IF EXISTS "admin_read_pq_scores" ON public.package_quality_scores;
CREATE POLICY "service_role_all" ON public.package_quality_scores FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_pq_scores" ON public.package_quality_scores FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.synthetic_test_results;
DROP POLICY IF EXISTS "admin_read_synthetic" ON public.synthetic_test_results;
CREATE POLICY "service_role_all" ON public.synthetic_test_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_synthetic" ON public.synthetic_test_results FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service_role_all" ON public.runbook_entries;
DROP POLICY IF EXISTS "admin_read_runbooks" ON public.runbook_entries;
CREATE POLICY "service_role_all" ON public.runbook_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_runbooks" ON public.runbook_entries FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin_manage_cost_budgets" ON public.ai_cost_budgets;
DROP POLICY IF EXISTS "service_role_all_budgets" ON public.ai_cost_budgets;
CREATE POLICY "admin_manage_cost_budgets" ON public.ai_cost_budgets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_all_budgets" ON public.ai_cost_budgets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admin_read_usage_log" ON public.ai_usage_log;
CREATE POLICY "admin_read_usage_log" ON public.ai_usage_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin_manage_perf" ON public.performance_metrics;
DROP POLICY IF EXISTS "service_role_all_perf" ON public.performance_metrics;
CREATE POLICY "admin_manage_perf" ON public.performance_metrics FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_all_perf" ON public.performance_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admin_manage_opt_reports" ON public.system_optimization_reports;
DROP POLICY IF EXISTS "service_role_all_opt" ON public.system_optimization_reports;
CREATE POLICY "admin_manage_opt_reports" ON public.system_optimization_reports FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_all_opt" ON public.system_optimization_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- S3: Enable RLS on 12 unprotected tables
-- ============================================================

ALTER TABLE public.channel_unit_economics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.channel_unit_economics;
CREATE POLICY "service_role_all" ON public.channel_unit_economics FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.course_title_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.course_title_aliases;
CREATE POLICY "service_role_all" ON public.course_title_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.curriculum_intelligence_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_intelligence_scores;
CREATE POLICY "service_role_all" ON public.curriculum_intelligence_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.curriculum_market_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_market_signals;
CREATE POLICY "service_role_all" ON public.curriculum_market_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.curriculum_priority_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_priority_recommendations;
CREATE POLICY "service_role_all" ON public.curriculum_priority_recommendations FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.curriculum_signal_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_signal_runs;
CREATE POLICY "service_role_all" ON public.curriculum_signal_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.curriculum_unit_economics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.curriculum_unit_economics;
CREATE POLICY "service_role_all" ON public.curriculum_unit_economics FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.executive_rebalance_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.executive_rebalance_runs;
CREATE POLICY "service_role_all" ON public.executive_rebalance_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.forbidden_db_indexes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.forbidden_db_indexes;
CREATE POLICY "service_role_all" ON public.forbidden_db_indexes FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.ops_job_type_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.ops_job_type_registry;
CREATE POLICY "service_role_all" ON public.ops_job_type_registry FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.package_progress_drift_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.package_progress_drift_audit;
CREATE POLICY "service_role_all" ON public.package_progress_drift_audit FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.pipeline_dag_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.pipeline_dag_edges;
CREATE POLICY "service_role_all" ON public.pipeline_dag_edges FOR ALL TO service_role USING (true) WITH CHECK (true);
