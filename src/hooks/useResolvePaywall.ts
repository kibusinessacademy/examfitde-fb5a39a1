import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ResolvedPaywall {
  has_access: boolean;
  access_type?: 'entitlement' | 'org_license';
  variant?: {
    variant_key: string;
    price_cents: number;
    currency: string;
    layout: 'minimal' | 'standard' | 'value_heavy' | 'urgency' | 'social_proof';
    trigger_context: string;
    urgency_type: string;
    headline: string | null;
    subheadline: string | null;
    cta_text: string;
    features_json: string[];
    is_control: boolean;
  };
  checkout_id: string | null;
  actual_price_cents: number | null;
  platform: 'web' | 'ios' | 'android';
}

/**
 * Resolves paywall state for a product:
 * - has_access=true → user owns it
 * - has_access=false → returns variant with checkout info
 */
export function useResolvePaywall(
  productId: string | null,
  options?: {
    experimentKey?: string;
    platform?: 'web' | 'ios' | 'android';
    triggerContext?: string;
  }
) {
  const { user } = useAuth();
  const platform = options?.platform ?? 'web';

  return useQuery({
    queryKey: ['resolve-paywall', productId, user?.id, platform],
    queryFn: async (): Promise<ResolvedPaywall> => {
      const { data, error } = await supabase.functions.invoke('resolve-paywall', {
        body: {
          product_id: productId,
          experiment_key: options?.experimentKey ?? null,
          platform,
          trigger_context: options?.triggerContext ?? null,
        },
      });

      if (error) {
        console.error('Paywall resolution error:', error);
        throw error;
      }

      return data as ResolvedPaywall;
    },
    enabled: !!user && !!productId,
    staleTime: 1000 * 60 * 15, // 15 min cache
    refetchOnWindowFocus: false,
  });
}
