-- Increase wip_limit to 10 to allow STUDIUM alongside 9 vocational packages
UPDATE ops_pipeline_config SET value = '10', updated_at = now() WHERE key = 'wip_limit';
UPDATE ops_pipeline_config SET value = '10', updated_at = now() WHERE key = 'max_concurrent_packages';