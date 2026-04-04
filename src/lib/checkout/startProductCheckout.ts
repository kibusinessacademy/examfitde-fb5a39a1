/**
 * Product Checkout Launcher (B2C Einmalkauf)
 * 
 * Calls create-product-checkout edge function and redirects to Stripe.
 */
import { supabase } from "@/integrations/supabase/client";
import { TrackingEvents } from "@/lib/tracking/track";

export interface CheckoutResult {
  ok: boolean;
  checkout_url?: string;
  order_id?: string;
  error?: string;
  already_entitled?: boolean;
}

export async function startProductCheckout(productSlug: string): Promise<CheckoutResult> {
  // Track checkout start
  await TrackingEvents.checkoutStarted(productSlug);

  const { data, error } = await supabase.functions.invoke("create-product-checkout", {
    body: { product_slug: productSlug },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const result = data as CheckoutResult;

  if (result.already_entitled) {
    return result;
  }

  if (result.ok && result.checkout_url) {
    // Redirect to Stripe
    window.location.href = result.checkout_url;
  }

  return result;
}
