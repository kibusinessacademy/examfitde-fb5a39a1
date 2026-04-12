
-- Add missing DAG edges for the blueprint variants chain
INSERT INTO pipeline_dag_edges (step_key, depends_on) VALUES
  ('generate_blueprint_variants', 'validate_blueprints'),
  ('validate_blueprint_variants', 'generate_blueprint_variants'),
  ('promote_blueprint_variants', 'validate_blueprint_variants')
ON CONFLICT DO NOTHING;
