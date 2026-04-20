import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

export interface ResolvedPaywallVariant {
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
  web_price_cents?: number;
  ios_price_cents?: number;
  android_price_cents?: number;
  stripe_price_id?: string | null;
  apple_sku?: string | null;
  google_sku?: string | null;
  assigned?: boolean;
}

export interface ResolvedPaywall {
  has_access: boolean;
  access_type?: 'entitlement' | 'org_license';
  experiment_key?: string | null;
  variant?: ResolvedPaywallVariant | null;
  checkout_id: string | null;
  actual_price_cents: number | null;
  platform: 'web' | 'ios' | 'android';
}

interface Options {
  productId?: string | null;
  packageId?: string | null;
  experimentKey?: string;
  platform?: 'web' | 'ios' | 'android';
  triggerContext?: string;
  /** Disable until true; useful to defer until SSOT loaded */
  enabled?: boolean;
}

/**
 * Resolves the paywall state for either a product or a package.
 * Works for anon visitors via cookie-bound visitor_id.
 */
export function useResolvePaywall(opts: Options) {
  const { user } = useAuth();
  const platform = opts.platform ?? 'web';
  const visitorId = getOrCreateVisitorId();

  const enabled =
    (opts.enabled ?? true) && Boolean(opts.productId || opts.packageId) && Boolean(visitorId);

  return useQuery({
    queryKey: [
      'resolve-paywall',
      opts.productId ?? null,
      opts.packageId ?? null,
      user?.id ?? visitorId,
      platform,
    ],
    enabled,
    staleTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ResolvedPaywall> => {
      const { data, error } = await supabase.functions.invoke('resolve-paywall', {
        body: {
          product_id: opts.productId ?? null,
          package_id: opts.packageId ?? null,
          experiment_key: opts.experimentKey ?? null,
          visitor_id: visitorId,
          platform,
          trigger_context: opts.triggerContext ?? 'product_page_view',
        },
      });

      if (error) {
        // eslint-disable-next-line no-console
        console.error('Paywall resolution error:', error);
        throw error;
      }

      return data as ResolvedPaywall;
    },
  });
}
