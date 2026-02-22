-- =========================================================
-- Smart Ticket System: Extended Types + ticket_links
-- =========================================================

-- 1) Add new ticket types
ALTER TYPE user_ticket_type ADD VALUE IF NOT EXISTS 'BILLING_QUESTION';
ALTER TYPE user_ticket_type ADD VALUE IF NOT EXISTS 'LICENSE_QUESTION';
ALTER TYPE user_ticket_type ADD VALUE IF NOT EXISTS 'LEARNER_ACCOUNT_ISSUE';
ALTER TYPE user_ticket_type ADD VALUE IF NOT EXISTS 'DATA_CORRECTION';
ALTER TYPE user_ticket_type ADD VALUE IF NOT EXISTS 'TECHNICAL_ISSUE';

-- 2) ticket_links: flexible entity associations per ticket
CREATE TABLE IF NOT EXISTS public.ticket_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.user_tickets(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN (
    'INVOICE','PAYMENT','ORDER','BILLING_ACCOUNT','LEARNER','LICENSE',
    'COMPANY','CERTIFICATION','LESSON','QUESTION','BLUEPRINT','SEAT'
  )),
  entity_id uuid NOT NULL,
  label text NULL,             -- human-readable e.g. "RE-2025-0042"
  meta jsonb NULL DEFAULT '{}', -- e.g. {amount_cents: 4900, status: "paid"}
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_links_ticket_idx ON public.ticket_links (ticket_id);
CREATE INDEX IF NOT EXISTS ticket_links_entity_idx ON public.ticket_links (entity_type, entity_id);

ALTER TABLE public.ticket_links ENABLE ROW LEVEL SECURITY;

-- Learner can read own ticket links (via ticket ownership)
CREATE POLICY "ticket_links_select_own" ON public.ticket_links
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_tickets t
    WHERE t.id = ticket_links.ticket_id AND t.created_by = auth.uid()
  )
);

-- Insert only for own tickets
CREATE POLICY "ticket_links_insert_own" ON public.ticket_links
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_tickets t
    WHERE t.id = ticket_links.ticket_id AND t.created_by = auth.uid()
  )
);

-- Admin can do everything
CREATE POLICY "ticket_links_admin_all" ON public.ticket_links
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
