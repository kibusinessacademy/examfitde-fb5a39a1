import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface PaywallVariant {
  variant_key: string;
  price_cents: number;
  currency: string;
  layout: 'minimal' | 'standard' | 'value_heavy' | 'urgency' | 'social_proof';
  trigger_context: string;
  urgency_type: string;
  headline: string | null;
  subheadline: string | null;
  cta_text: string;
  features_json: unknown[];
  stripe_price_id: string | null;
  apple_sku: string | null;
  google_sku: string | null;
  is_control: boolean;
  assigned: boolean;
  web_price_cents: number | null;
  ios_price_cents: number | null;
  android_price_cents: number | null;
  error?: string;
}

/**
 * Resolves the paywall variant for the current user and experiment.
 * Sticky: once assigned, always returns the same variant.
 * Uses server-side weighted random assignment via RPC.
 */
export function usePaywallVariant(
  experimentKey: string | null,
  platform: 'web' | 'ios' | 'android' = 'web'
) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['paywall-variant', experimentKey, user?.id],
    queryFn: async (): Promise<PaywallVariant | null> => {
      if (!user || !experimentKey) return null;

      const { data, error } = await supabase.rpc('assign_paywall_variant', {
        p_user_id: user.id,
        p_experiment_key: experimentKey,
        p_platform: platform,
      });

      if (error) {
        console.error('Paywall variant assignment error:', error);
        return null;
      }

      const result = data as unknown as PaywallVariant;
      if (result?.error) {
        console.warn('Paywall experiment not found:', result.error);
        return null;
      }

      return result;
    },
    enabled: !!user && !!experimentKey,
    staleTime: 1000 * 60 * 30, // 30 min — sticky assignment
    refetchOnWindowFocus: false,
  });
}

/**
 * Records a conversion event for an experiment.
 * Called after successful purchase.
 */
export function useRecordConversion() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      experimentKey,
      valueCents,
    }: {
      experimentKey: string;
      valueCents: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.rpc('record_experiment_conversion', {
        p_user_id: user.id,
        p_experiment_key: experimentKey,
        p_value_cents: valueCents,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paywall-variant'] });
    },
  });
}

/**
 * Returns the correct checkout identifier based on platform.
 * Web → stripe_price_id, iOS → apple_sku, Android → google_sku
 */
export function getCheckoutId(
  variant: PaywallVariant | null,
  platform: 'web' | 'ios' | 'android'
): string | null {
  if (!variant) return null;
  switch (platform) {
    case 'web': return variant.stripe_price_id;
    case 'ios': return variant.apple_sku;
    case 'android': return variant.google_sku;
    default: return variant.stripe_price_id;
  }
}

/**
 * Returns the actual price in cents for the given platform.
 * Falls back to display price_cents if no channel-specific price is set.
 */
export function getChannelPrice(
  variant: PaywallVariant | null,
  platform: 'web' | 'ios' | 'android'
): number | null {
  if (!variant) return null;
  switch (platform) {
    case 'web': return variant.web_price_cents ?? variant.price_cents;
    case 'ios': return variant.ios_price_cents ?? variant.price_cents;
    case 'android': return variant.android_price_cents ?? variant.price_cents;
    default: return variant.price_cents;
  }
}
