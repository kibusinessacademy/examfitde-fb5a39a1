import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTrackGrowthEvent } from './useTrackGrowthEvent';

interface CheckoutParams {
  productId: string;
  /** For paywall variant flow */
  experimentKey?: string;
  variantKey?: string;
  triggerContext?: string;
  /** For pricing plan flow */
  pricingPlanId?: string;
  orgName?: string;
  successUrl?: string;
  cancelUrl?: string;
}

/**
 * Starts a Stripe Checkout session via the create-payment edge function.
 * Tracks cta_click + checkout_started events.
 * Redirects to Stripe on success.
 */
export function useStartCheckout() {
  const { track } = useTrackGrowthEvent();

  return useMutation({
    mutationFn: async (params: CheckoutParams) => {
      // Track CTA click
      track('cta_click', {
        product_id: params.productId,
        experiment_key: params.experimentKey,
        variant_key: params.variantKey,
        trigger_context: params.triggerContext,
        plan_id: params.pricingPlanId,
      });

      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: {
          product_id: params.productId,
          experiment_key: params.experimentKey ?? null,
          variant_key: params.variantKey ?? null,
          trigger_context: params.triggerContext ?? null,
          pricing_plan_id: params.pricingPlanId ?? null,
          org_name: params.orgName ?? null,
          success_url: params.successUrl ?? null,
          cancel_url: params.cancelUrl ?? null,
        },
      });

      if (error) throw error;
      if (!data?.checkout_url) throw new Error('No checkout URL returned');

      return data as {
        checkout_url: string;
        session_id: string;
        product_id: string;
        experiment_key: string | null;
        variant_key: string | null;
        plan_key: string | null;
        seat_count: number;
      };
    },
    onSuccess: (data) => {
      // Track checkout started (server also tracks, but client-side is faster for analytics)
      track('checkout_started', {
        product_id: data.product_id,
        session_id: data.session_id,
        experiment_key: data.experiment_key,
        variant_key: data.variant_key,
      });

      // Redirect to Stripe
      window.location.href = data.checkout_url;
    },
  });
}
