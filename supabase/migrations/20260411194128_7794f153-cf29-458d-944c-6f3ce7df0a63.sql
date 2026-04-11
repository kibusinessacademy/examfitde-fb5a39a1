
-- ============================================================
-- GO-LIVE SECURITY HARDENING
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

-- === S1: Drop all {public} USING(true) policies on internal tables ===
DO $$ BEGIN
  -- Campaign & Marketing
  DROP POLICY IF EXISTS "Service role full access" ON public.campaign_asset_queue;
  DROP POLICY IF EXISTS "Service role full access" ON public.campaign_assets;
  DROP POLICY IF EXISTS "Service role full access" ON public.campaign_automation_runs;
  DROP POLICY IF EXISTS "Service role full access" ON public.campaign_launch_plans;
  DROP POLICY IF EXISTS "Service role full access" ON public.campaign_performance_snapshots;
  DROP POLICY IF EXISTS "Service role full access" ON public.channel_performance_profiles;
  DROP POLICY IF EXISTS "Service role full access" ON public.curriculum_gtm_scores;
  DROP POLICY IF EXISTS "Service role full access" ON public.curriculum_launch_recommendations;
  DROP POLICY IF EXISTS "Service role full access" ON public.curriculum_revenue_runs;
  DROP POLICY IF EXISTS "Service role full access" ON public.curriculum_revenue_signals;
  DROP POLICY IF EXISTS "Service role full access" ON public.curriculum_scaling_signals;
  DROP POLICY IF EXISTS "Service role full access" ON public.distribution_channel_configs;
  DROP POLICY IF EXISTS "Service role full access" ON public.distribution_delivery_logs;
  DROP POLICY IF EXISTS "Service role full access" ON public.distribution_publications;
  DROP POLICY IF EXISTS "Service role full access" ON public.distribution_queue;
  DROP POLICY IF EXISTS "Service role full access" ON public.distribution_runs;
  DROP POLICY IF EXISTS "Service role full access" ON public.distribution_targets;
  DROP POLICY IF EXISTS "Service role full access" ON public.optimization_actions;
  DROP POLICY IF EXISTS "Service role full access" ON public.optimization_observations;
  DROP POLICY IF EXISTS "Service role full access" ON public.optimization_runs;
  DROP POLICY IF EXISTS "Service role full access" ON public.asset_optimization_scores;
  -- Standalone
  DROP POLICY IF EXISTS "Service role full access on standalone_artifact_versions" ON public.standalone_artifact_versions;
  DROP POLICY IF EXISTS "Service role full access on standalone_backup_targets" ON public.standalone_backup_targets;
  DROP POLICY IF EXISTS "Service role full access on standalone_backups" ON public.standalone_backups;
  DROP POLICY IF EXISTS "Service role full access on standalone_license_devices" ON public.standalone_license_devices;
  DROP POLICY IF EXISTS "Service role full access on standalone_license_events" ON public.standalone_license_events;
  DROP POLICY IF EXISTS "Service role full access on standalone_licenses" ON public.standalone_licenses;
  DROP POLICY IF EXISTS "Service role full access on standalone_restore_events" ON public.standalone_restore_events;
  -- Pipeline & Ops
  DROP POLICY IF EXISTS "cpe_service_all" ON public.course_pipeline_events;
  DROP POLICY IF EXISTS "Service role manages pipeline_step_order" ON public.pipeline_step_order;
  DROP POLICY IF EXISTS "Pipeline lock readable by all authenticated" ON public.pipeline_lock;
  DROP POLICY IF EXISTS "service_role_full_access" ON public.ops_alert_events;
  DROP POLICY IF EXISTS "Service write portfolio_priority" ON public.portfolio_priority;
  DROP POLICY IF EXISTS "Admin read portfolio_priority" ON public.portfolio_priority;
  DROP POLICY IF EXISTS "Service write rollout_control" ON public.rollout_control;
  DROP POLICY IF EXISTS "Admin read rollout_control" ON public.rollout_control;
  -- Admin & Governance
  DROP POLICY IF EXISTS "service_write_search" ON public.admin_search_index;
  DROP POLICY IF EXISTS "service_only_api_rate_limits" ON public.api_rate_limits;
  DROP POLICY IF EXISTS "admin_all_authority_decisions" ON public.authority_decisions;
  DROP POLICY IF EXISTS "Admins read canary" ON public.canary_releases;
  DROP POLICY IF EXISTS "Service manages canary" ON public.canary_releases;
  DROP POLICY IF EXISTS "Admin read ceo_kpis" ON public.ceo_daily_kpis;
  DROP POLICY IF EXISTS "Admin access dominance snapshots" ON public.certification_dominance_snapshots;
  DROP POLICY IF EXISTS "admin_all_cds_snapshots" ON public.cluster_dominance_snapshots;
  DROP POLICY IF EXISTS "Admins can read competency stats" ON public.competency_performance_stats;
  DROP POLICY IF EXISTS "admin_all_dominance_control" ON public.dominance_control;
  DROP POLICY IF EXISTS "admin_all_market_clusters" ON public.market_clusters;
  DROP POLICY IF EXISTS "Admin read deep_audit_config" ON public.deep_audit_config;
  DROP POLICY IF EXISTS "Service write deep_audit_config" ON public.deep_audit_config;
  DROP POLICY IF EXISTS "Admin read deep_audit_results" ON public.deep_audit_results;
  DROP POLICY IF EXISTS "Service write deep_audit_results" ON public.deep_audit_results;
  DROP POLICY IF EXISTS "Admin read slo_metrics" ON public.slo_metrics;
  DROP POLICY IF EXISTS "Admin read synthetic_tests" ON public.synthetic_test_results;
  DROP POLICY IF EXISTS "Admin read runbooks" ON public.runbook_entries;
  DROP POLICY IF EXISTS "Admin read audit snapshots" ON public.quality_audit_snapshots;
  DROP POLICY IF EXISTS "quality_score_versions_read" ON public.quality_score_versions;
  -- Content
  DROP POLICY IF EXISTS "Admin full access on blog_posts" ON public.blog_posts;
  DROP POLICY IF EXISTS "Admin full access on content_assets" ON public.content_assets;
  DROP POLICY IF EXISTS "Admin full access on content_pages" ON public.content_pages;
  DROP POLICY IF EXISTS "Admin full access on seo_redirects" ON public.seo_redirects;
  -- Exam & Quality
  DROP POLICY IF EXISTS "Service role full access on exam_part_mappings" ON public.exam_part_mappings;
  DROP POLICY IF EXISTS "Service role full access on elite annotations" ON public.exam_question_elite_annotations;
  DROP POLICY IF EXISTS "Service role full access on difficulty_distribution_targets" ON public.difficulty_distribution_targets;
  DROP POLICY IF EXISTS "Service manages golden sets" ON public.golden_exam_sets;
  DROP POLICY IF EXISTS "Anyone reads golden sets" ON public.golden_exam_sets;
  DROP POLICY IF EXISTS "Service role full access on humor_asset_reviews" ON public.humor_asset_reviews;
  DROP POLICY IF EXISTS "Service role full access on humor_generation_jobs" ON public.humor_generation_jobs;
  DROP POLICY IF EXISTS "Service write discrimination stats" ON public.question_discrimination_stats;
  DROP POLICY IF EXISTS "upd_qqm" ON public.question_quality_metrics;
  DROP POLICY IF EXISTS "read_qqm" ON public.question_quality_metrics;
  DROP POLICY IF EXISTS "Anyone reads qsm" ON public.question_skill_map;
  DROP POLICY IF EXISTS "Service manages qsm" ON public.question_skill_map;
  DROP POLICY IF EXISTS "Service manages variant stats" ON public.question_variant_stats;
  DROP POLICY IF EXISTS "Admin reads variant stats" ON public.question_variant_stats;
  DROP POLICY IF EXISTS "package_quality_scores_read" ON public.package_quality_scores;
  DROP POLICY IF EXISTS "read_pqs" ON public.package_quality_summary;
  DROP POLICY IF EXISTS "upd_pqs" ON public.package_quality_summary;
  DROP POLICY IF EXISTS "Admin full access certification_master" ON public.german_certification_master;
  -- Other
  DROP POLICY IF EXISTS "Anyone reads drift" ON public.drift_snapshots;
  DROP POLICY IF EXISTS "Service manages drift" ON public.drift_snapshots;
  DROP POLICY IF EXISTS "service_only_oral_exam_turns" ON public.oral_exam_turns;
  DROP POLICY IF EXISTS "Service updates outcomes" ON public.outcome_tracking;
  DROP POLICY IF EXISTS "product_factory_specs_service" ON public.product_factory_specs;
  DROP POLICY IF EXISTS "Allow service role full access" ON public.profession_profiles;
  DROP POLICY IF EXISTS "Allow read for authenticated" ON public.profession_profiles;
  DROP POLICY IF EXISTS "Anyone can claim" ON public.referral_invites;
  DROP POLICY IF EXISTS "Anyone reads skill_nodes" ON public.skill_nodes;
  DROP POLICY IF EXISTS "Service manages skill_nodes" ON public.skill_nodes;
  DROP POLICY IF EXISTS "step_dag_edges_read_all" ON public.step_dag_edges;
  DROP POLICY IF EXISTS "Service manages skill scores" ON public.user_skill_scores;
  DROP POLICY IF EXISTS "package_tags_public_read" ON public.package_tags;
  DROP POLICY IF EXISTS "tag_groups_public_read" ON public.tag_groups;
  DROP POLICY IF EXISTS "product_categories_public_read" ON public.product_categories;
  DROP POLICY IF EXISTS "product_subcategories_public_read" ON public.product_subcategories;
  DROP POLICY IF EXISTS "product_tags_public_read" ON public.product_tags;
  DROP POLICY IF EXISTS "pub_read_media" ON public.media_assets;
  DROP POLICY IF EXISTS "Service role full access on products" ON public.products;
  DROP POLICY IF EXISTS "Anyone can read session templates" ON public.oral_exam_session_templates;
  DROP POLICY IF EXISTS "Landing profiles are publicly readable" ON public.product_landing_profiles;
  DROP POLICY IF EXISTS "Module configs are publicly readable" ON public.product_module_configs;
  DROP POLICY IF EXISTS "Price tiers are viewable by everyone" ON public.product_price_tiers;
  DROP POLICY IF EXISTS "Pricing configs are publicly readable" ON public.product_pricing_configs;
  DROP POLICY IF EXISTS "Glossaries readable by authenticated" ON public.profession_glossaries;
  DROP POLICY IF EXISTS "Anyone can read store policy flags" ON public.store_policy_flags;
  DROP POLICY IF EXISTS "Public can read themes" ON public.work_brand_themes;
  DROP POLICY IF EXISTS "Public can read covers" ON public.work_cover_assets;
  DROP POLICY IF EXISTS "Public can read default templates" ON public.work_pdf_templates;
END $$;

-- === S1: Create correct policies ===
-- Internal tables: service_role ALL + admin read
DO $$
DECLARE
  t text;
  internal_tables text[] := ARRAY[
    'campaign_asset_queue','campaign_assets','campaign_automation_runs','campaign_launch_plans',
    'campaign_performance_snapshots','channel_performance_profiles','curriculum_gtm_scores',
    'curriculum_launch_recommendations','curriculum_revenue_runs','curriculum_revenue_signals',
    'curriculum_scaling_signals','distribution_channel_configs','distribution_delivery_logs',
    'distribution_publications','distribution_queue','distribution_runs','distribution_targets',
    'optimization_actions','optimization_observations','optimization_runs','asset_optimization_scores',
    'standalone_artifact_versions','standalone_backup_targets','standalone_backups',
    'standalone_license_devices','standalone_license_events','standalone_licenses','standalone_restore_events',
    'course_pipeline_events','pipeline_step_order','pipeline_lock','ops_alert_events',
    'portfolio_priority','rollout_control','admin_search_index','api_rate_limits',
    'authority_decisions','canary_releases','ceo_daily_kpis','certification_dominance_snapshots',
    'cluster_dominance_snapshots','competency_performance_stats','dominance_control','market_clusters',
    'deep_audit_config','deep_audit_results','slo_metrics','synthetic_test_results','runbook_entries',
    'quality_audit_snapshots','quality_score_versions','exam_part_mappings',
    'exam_question_elite_annotations','difficulty_distribution_targets','golden_exam_sets',
    'humor_asset_reviews','humor_generation_jobs','question_discrimination_stats',
    'question_quality_metrics','question_skill_map','question_variant_stats',
    'package_quality_scores','package_quality_summary','german_certification_master',
    'drift_snapshots','oral_exam_turns','outcome_tracking','product_factory_specs',
    'referral_invites','user_skill_scores'
  ];
BEGIN
  FOREACH t IN ARRAY internal_tables LOOP
    EXECUTE format('CREATE POLICY "sr_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "admin_read" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))', t);
  END LOOP;
END $$;

-- Content tables: service_role ALL + admin ALL + public read for published
DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY['blog_posts','content_assets','content_pages','seo_redirects'];
BEGIN
  FOREACH t IN ARRAY content_tables LOOP
    EXECUTE format('CREATE POLICY "sr_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "admin_all" ON public.%I FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''admin'')) WITH CHECK (public.has_role(auth.uid(), ''admin''))', t);
  END LOOP;
END $$;
CREATE POLICY "pub_read_published" ON public.blog_posts FOR SELECT TO anon, authenticated USING (status = 'published');

-- Public-readable catalog tables: anon+authenticated SELECT
DO $$
DECLARE
  t text;
  pub_tables text[] := ARRAY[
    'package_tags','tag_groups','product_categories','product_subcategories','product_tags',
    'media_assets','products','oral_exam_session_templates','product_landing_profiles',
    'product_module_configs','product_price_tiers','product_pricing_configs',
    'profession_glossaries','store_policy_flags','work_brand_themes','work_cover_assets',
    'work_pdf_templates','profession_profiles','skill_nodes','step_dag_edges'
  ];
BEGIN
  FOREACH t IN ARRAY pub_tables LOOP
    EXECUTE format('CREATE POLICY "sr_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "pub_read" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
  END LOOP;
END $$;

-- Special user-specific policies
CREATE POLICY "user_read_own" ON public.oral_exam_turns FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_read_own" ON public.user_skill_scores FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "auth_claim" ON public.referral_invites FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_read" ON public.referral_invites FOR SELECT TO authenticated USING (true);

-- === S2: Remove internal tables from Realtime ===
ALTER PUBLICATION supabase_realtime DROP TABLE public.competency_performance_stats;
ALTER PUBLICATION supabase_realtime DROP TABLE public.content_assets;
ALTER PUBLICATION supabase_realtime DROP TABLE public.content_pages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.package_quality_summary;
ALTER PUBLICATION supabase_realtime DROP TABLE public.question_quality_metrics;

-- === S3: Add policies to ~105 tables with RLS but NO policies ===
DO $$
DECLARE
  t text;
  orphan_tables text[] := ARRAY[
    'ai_budget_policies','ai_generation_cache','ai_generation_policies','ai_generation_requests',
    'anthropic_batch_requests','anthropic_batches','audit_remediation_actions','backpressure_snapshots',
    'business_kpi_snapshots','certification_cost_snapshots','content_generation_jobs',
    'content_research_cache','content_ssot_context','control_plane_actions','control_plane_alerts',
    'control_plane_cost_signals','control_plane_policies','control_plane_snapshots',
    'curriculum_intake_candidates','curriculum_intake_jobs','curriculum_intake_parsed',
    'curriculum_intake_promotion_log','curriculum_source_documents','curriculum_source_registry',
    'escalation_log','exam_pool_validation_snapshots','exam_promotion_audit',
    'executive_budget_caps','executive_kill_switches','executive_portfolio_allocations',
    'executive_portfolio_decisions','executive_summary_reports','factory_autonomy_policies',
    'factory_intake_queue','fi_core_lf_equivalence','growth_metrics','intake_raw_documents',
    'job_costs','job_type_policies','knowledge_graph_edges','knowledge_graph_enrichment_queue',
    'knowledge_graph_nodes','learning_field_elite_policies','lesson_content_backups',
    'lesson_minicheck_questions','llm_provider_routing_policies','newsletter_campaigns',
    'offers','ops_ddl_audit','ops_pipeline_config','ops_worker_heartbeats','orchestrator_leases',
    'partner_audit_events','pipeline_health_events','pipeline_settings','premium_upgrade_runs',
    'pricing_rules','product_bundles','provider_intent_affinity','provider_job_affinity',
    'provider_pricing','provider_status','provider_usage_history','qualification_candidates',
    'qualification_discovery_patterns','qualification_fetch_queue','qualification_search_results',
    'qualification_search_runs','qualification_source_registry','retention_actions',
    'revenue_metrics_daily','roi_decision_rules','step_metrics','system_contract_registry',
    'system_contract_violations','system_cron_executions','system_cron_registry','system_cron_runs',
    'system_enum_registry','system_execution_leases','system_heal_log','system_health_assertions',
    'system_orphan_executions','system_probe_alerts','system_probe_definitions',
    'system_probe_results','system_probe_runs','system_regression_snapshots','system_retry_policies',
    'system_runner_registry','system_scheduler_guardrails','system_ssot_mappings',
    'ugc_content','urgency_signals','user_revenue_profile','viral_hooks',
    'wave_governance_decisions','work_affiliate_clicks','work_affiliate_payouts','work_affiliates',
    'work_bundle_purchases','work_corporate_commerce','work_coupon_redemptions','work_coupons',
    'work_email_outbox','worker_scaling_policies'
  ];
BEGIN
  FOREACH t IN ARRAY orphan_tables LOOP
    EXECUTE format('CREATE POLICY "sr_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "admin_read" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))', t);
  END LOOP;
END $$;
