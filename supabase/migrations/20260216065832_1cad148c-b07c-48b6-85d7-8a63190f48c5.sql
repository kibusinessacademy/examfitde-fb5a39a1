
-- Add Growth-Loop KPI columns to CEO dashboard
ALTER TABLE public.ceo_daily_kpis
  ADD COLUMN IF NOT EXISTS shares_total integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_whatsapp integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_linkedin integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS badge_share_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_claims integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_conversion numeric DEFAULT 0;

-- Add channel column to share_events if missing (it uses share_channel already)
-- Add event_type column for filtering exam results vs other shares
ALTER TABLE public.share_events
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';
