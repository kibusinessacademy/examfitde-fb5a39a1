
-- Raise WIP cap to 20
INSERT INTO ops_pipeline_config (key, value)
VALUES ('wip_total_cap', '20')
ON CONFLICT (key) DO UPDATE SET value = '20', updated_at = now();
