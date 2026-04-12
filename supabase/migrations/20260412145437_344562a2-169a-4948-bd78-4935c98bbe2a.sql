
-- Fix: generate_exam_pool depends on promote_blueprint_variants, not validate_blueprints
DELETE FROM pipeline_dag_edges WHERE step_key = 'generate_exam_pool' AND depends_on = 'validate_blueprints';
INSERT INTO pipeline_dag_edges (step_key, depends_on) VALUES ('generate_exam_pool', 'promote_blueprint_variants')
ON CONFLICT DO NOTHING;
