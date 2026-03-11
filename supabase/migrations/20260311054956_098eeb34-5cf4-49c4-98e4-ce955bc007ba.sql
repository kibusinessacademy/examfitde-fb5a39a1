-- Raise WIP limit to 4 (3 additional slots)
UPDATE ops_pipeline_config SET value = '4', updated_at = now() WHERE key = 'wip_limit';

-- Promote top 3 queued packages to priority 1-3 so they get picked by lease acquisition
UPDATE course_packages SET priority = 1, updated_at = now() WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7';
UPDATE course_packages SET priority = 2, updated_at = now() WHERE id = '52c2fa86-6355-46a4-bfc3-6510fcc6ac04';
UPDATE course_packages SET priority = 3, updated_at = now() WHERE id = 'fdf4c23c-be16-43ed-ac0e-aea0ab64665f';