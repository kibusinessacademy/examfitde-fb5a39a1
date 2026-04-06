
CREATE OR REPLACE FUNCTION public.fn_upsert_variant_inventory(
  p_blueprint_id uuid,
  p_curriculum_id uuid,
  p_new_materialized int DEFAULT 0,
  p_new_approved int DEFAULT 0
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO blueprint_variant_inventory (blueprint_id, curriculum_id, materialized_count, approved_count, last_job_at)
  VALUES (p_blueprint_id, p_curriculum_id, p_new_materialized, p_new_approved, now())
  ON CONFLICT (blueprint_id, curriculum_id) DO UPDATE SET
    materialized_count = blueprint_variant_inventory.materialized_count + p_new_materialized,
    approved_count = blueprint_variant_inventory.approved_count + p_new_approved,
    last_job_at = now();
END;
$$;
