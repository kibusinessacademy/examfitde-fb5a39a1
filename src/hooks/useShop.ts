import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Product {
  id: string;
  product_key: string;
  name: string;
  description: string | null;
  includes_learning_course: boolean;
  includes_exam_trainer: boolean;
  includes_ai_tutor: boolean;
  includes_oral_trainer: boolean;
  sort_order: number;
}

interface PriceTier {
  id: string;
  product_id: string;
  min_quantity: number;
  max_quantity: number | null;
  price_cents: number;
}

interface PriceCalculation {
  unit_price_cents: number;
  total_price_cents: number;
  tier_name: string;
}

export function useShopProducts() {
  return useQuery({
    queryKey: ['shop-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_products')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return data as Product[];
    },
  });
}

export function usePriceTiers(productId: string | undefined) {
  return useQuery({
    queryKey: ['price-tiers', productId],
    queryFn: async () => {
      if (!productId) return [];
      
      const { data, error } = await supabase
        .from('product_price_tiers')
        .select('*')
        .eq('product_id', productId)
        .order('min_quantity');

      if (error) throw error;
      return data as PriceTier[];
    },
    enabled: !!productId,
  });
}

export function useCalculatePrice(productId: string | undefined, quantity: number) {
  return useQuery({
    queryKey: ['calculate-price', productId, quantity],
    queryFn: async () => {
      if (!productId || quantity < 1) return null;
      
      const { data, error } = await supabase
        .rpc('calculate_product_price', {
          p_product_id: productId,
          p_quantity: quantity
        });

      if (error) throw error;
      return data?.[0] as PriceCalculation | null;
    },
    enabled: !!productId && quantity >= 1,
  });
}

export function useCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initiateCheckout = async (
    productKey: string,
    curriculumId: string,
    quantity: number
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-checkout', {
        body: {
          product_key: productKey,
          curriculum_id: curriculumId,
          quantity,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      if (data?.url) {
        window.open(data.url, '_blank');
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout fehlgeschlagen';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    initiateCheckout,
    isLoading,
    error,
  };
}

export function useVerifyPurchase() {
  const [isLoading, setIsLoading] = useState(false);

  const verifyPurchase = async (sessionId: string) => {
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('verify-purchase', {
        body: { session_id: sessionId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    verifyPurchase,
    isLoading,
  };
}

/** @deprecated Use useProductAccessByCurriculum from useProductAccess.ts instead */
export function useUserEntitlements(curriculumId?: string) {
  return useQuery({
    queryKey: ['user-entitlements-shop-legacy', curriculumId],
    queryFn: async () => {
      console.warn('[DEPRECATED] useShop.useUserEntitlements called — migrate to useProductAccessByCurriculum');
      return [];
    },
  });
}
