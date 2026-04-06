
-- Phase 2: variant_prebuild_status on course_packages (was rolled back)
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS variant_prebuild_status text NOT NULL DEFAULT 'pending';

COMMENT ON COLUMN public.course_packages.variant_prebuild_status IS
  'Prebuild lifecycle: pending → materializing → ready → stale → failed';

-- Verify blueprint_variant_inventory exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'blueprint_variant_inventory' AND table_schema = 'public') THEN
    CREATE TABLE public.blueprint_variant_inventory (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      blueprint_id uuid NOT NULL,
      curriculum_id uuid NOT NULL,
      package_id uuid,
      target_count int NOT NULL DEFAULT 20,
      materialized_count int NOT NULL DEFAULT 0,
      approved_count int NOT NULL DEFAULT 0,
      coverage_ratio numeric GENERATED ALWAYS AS (
        CASE WHEN target_count > 0
             THEN round(materialized_count::numeric / target_count, 4)
             ELSE 0 END
      ) STORED,
      status text NOT NULL DEFAULT 'missing',
      last_job_at timestamptz,
      last_error text,
      fingerprint text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX uq_bvi_blueprint_curriculum ON public.blueprint_variant_inventory (blueprint_id, curriculum_id);
    CREATE INDEX idx_bvi_curriculum ON public.blueprint_variant_inventory (curriculum_id);
    CREATE INDEX idx_bvi_status ON public.blueprint_variant_inventory (status);
    CREATE INDEX idx_bvi_package ON public.blueprint_variant_inventory (package_id) WHERE package_id IS NOT NULL;

    ALTER TABLE public.blueprint_variant_inventory ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Admin read blueprint_variant_inventory"
      ON public.blueprint_variant_inventory FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));

    CREATE POLICY "Admin write blueprint_variant_inventory"
      ON public.blueprint_variant_inventory FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
