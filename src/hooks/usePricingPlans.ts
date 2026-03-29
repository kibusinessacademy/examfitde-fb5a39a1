import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PricingPlan {
  id: string;
  plan_key: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  audience_type: 'b2c' | 'b2b';
  seat_count: number | null;
  price_cents: number | null;
  currency: string;
  duration_days: number;
  checkout_mode: 'self_service' | 'sales';
  stripe_price_id: string | null;
  sort_order: number;
  is_featured: boolean;
  features_json: string[];
}

export function usePricingPlans(
  productId: string | undefined,
  audienceType?: 'b2c' | 'b2b'
) {
  return useQuery({
    queryKey: ['pricing-plans', productId, audienceType],
    queryFn: async () => {
      if (!productId) return [];

      const { data, error } = await supabase.rpc(
        'resolve_pricing_plans' as any,
        {
          p_product_id: productId,
          p_audience_type: audienceType ?? null,
        }
      );

      if (error) throw error;
      return (data || []) as PricingPlan[];
    },
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateSalesLead() {
  return useMutation({
    mutationFn: async (params: {
      orgName?: string;
      contactName?: string;
      contactEmail?: string;
      productId?: string;
      planKey?: string;
      seatCount?: number;
      message?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase.rpc(
        'create_sales_lead' as any,
        {
          p_user_id: user?.id ?? null,
          p_org_name: params.orgName ?? null,
          p_contact_name: params.contactName ?? null,
          p_contact_email: params.contactEmail ?? null,
          p_product_id: params.productId ?? null,
          p_plan_key: params.planKey ?? null,
          p_seat_count: params.seatCount ?? null,
          p_message: params.message ?? null,
          p_source: 'pricing_page',
        }
      );

      if (error) throw error;
      return data as string;
    },
  });
}
