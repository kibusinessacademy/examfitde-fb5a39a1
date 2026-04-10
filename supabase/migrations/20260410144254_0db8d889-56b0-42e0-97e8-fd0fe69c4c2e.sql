
-- Add category column to org_licenses for direct category-based access checks
ALTER TABLE public.org_licenses
ADD COLUMN IF NOT EXISTS category text;

-- Create index for fast category lookups
CREATE INDEX IF NOT EXISTS idx_org_licenses_category ON public.org_licenses(category);

-- Create function to check team access by category
CREATE OR REPLACE FUNCTION public.check_team_access(
  p_user_id uuid,
  p_category text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_license_seats ols
    JOIN org_licenses ol ON ol.id = ols.license_id
    WHERE ols.user_id = p_user_id
      AND ols.released_at IS NULL
      AND ol.category = p_category
      AND ol.status = 'active'
      AND (ol.ends_at IS NULL OR ol.ends_at > now())
  );
$$;

-- Create unified access check function combining B2C entitlements + B2B team seats
CREATE OR REPLACE FUNCTION public.check_unified_access(
  p_user_id uuid,
  p_product_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- B2C: personal entitlement by product
    EXISTS (
      SELECT 1 FROM entitlements
      WHERE user_id = p_user_id
        AND (p_product_id IS NULL OR product_id = p_product_id)
        AND valid_until > now()
    )
    OR
    -- B2B: team seat by category
    (p_category IS NOT NULL AND check_team_access(p_user_id, p_category));
$$;
