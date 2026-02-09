
-- Create anonymized view for affiliate referrals (hides referred_user_id)
-- Uses security_invoker so RLS on the underlying table is enforced
CREATE OR REPLACE VIEW public.affiliate_referrals_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  affiliate_id,
  course_id,
  purchase_amount,
  commission_amount,
  referred_at,
  confirmed_at,
  paid_at,
  status
FROM public.affiliate_referrals;

-- Grant access to authenticated users
GRANT SELECT ON public.affiliate_referrals_safe TO authenticated;

COMMENT ON VIEW public.affiliate_referrals_safe IS 'Anonymized affiliate referrals view — referred_user_id is excluded for privacy';
