-- Stripe Auto-Sync: Schema + DLQ + DB-Trigger
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stripe_product_id text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stripe_synced_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_stripe_product_id
  ON public.products (stripe_product_id) WHERE stripe_product_id IS NOT NULL;

-- Observability / DLQ
CREATE TABLE IF NOT EXISTS public.stripe_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('success','failed','skipped')),
  error_message text,
  stripe_product_id text,
  stripe_price_id text,
  attempt_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_sync_log TO authenticated;
GRANT ALL ON public.stripe_sync_log TO service_role;

CREATE INDEX IF NOT EXISTS idx_stripe_sync_log_product_id ON public.stripe_sync_log(product_id);
CREATE INDEX IF NOT EXISTS idx_stripe_sync_log_status ON public.stripe_sync_log(status) WHERE status = 'failed';

ALTER TABLE public.stripe_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_sync_log_service_only ON public.stripe_sync_log;
CREATE POLICY stripe_sync_log_service_only ON public.stripe_sync_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS stripe_sync_log_admin_read ON public.stripe_sync_log;
CREATE POLICY stripe_sync_log_admin_read ON public.stripe_sync_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Trigger: async pg_net call to edge function for newly activated products w/o Stripe id
CREATE OR REPLACE FUNCTION public.trigger_stripe_sync_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_secret text;
  v_function_url text := current_setting('app.settings.stripe_sync_function_url', true);
BEGIN
  IF NEW.status = 'active' AND NEW.stripe_product_id IS NULL THEN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'stripe_sync_webhook_secret'
    LIMIT 1;

    IF v_secret IS NULL OR v_function_url IS NULL THEN
      INSERT INTO public.stripe_sync_log (product_id, status, error_message, attempt_count)
      VALUES (NEW.id, 'failed', 'missing vault secret or function url config', 1);
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := v_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', v_secret
      ),
      body := jsonb_build_object('product_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stripe_sync_product ON public.products;
CREATE TRIGGER trg_stripe_sync_product
  AFTER INSERT OR UPDATE OF status, stripe_product_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_stripe_sync_product();