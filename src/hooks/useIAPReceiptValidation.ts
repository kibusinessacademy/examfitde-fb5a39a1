/**
 * useIAPReceiptValidation
 *
 * Universal client helper for validating Apple App Store + Google Play receipts
 * through the `validate-iap-receipt` edge function. On success it invalidates
 * the product/curriculum access caches so the course player unlocks immediately.
 *
 * Usage (after a Capacitor IAP purchase resolves):
 *   const { mutateAsync: validate } = useIAPReceiptValidation();
 *   await validate({ platform: 'ios', sku, curriculum_id, transaction_id, receipt_data });
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type IAPPlatform = "ios" | "android";

export interface IAPValidationInput {
  platform: IAPPlatform;
  sku: string;
  curriculum_id: string;
  // iOS
  transaction_id?: string;
  receipt_data?: string;
  // Android
  purchase_token?: string;
  order_id?: string;
  package_name?: string;
}

export interface IAPValidationResult {
  success: boolean;
  duplicate?: boolean;
  receipt_id?: string;
  entitlement_id?: string;
  expires_at?: string;
  platform: IAPPlatform;
  error?: string;
}

export function useIAPReceiptValidation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: IAPValidationInput): Promise<IAPValidationResult> => {
      const { data, error } = await supabase.functions.invoke<IAPValidationResult>(
        "validate-iap-receipt",
        { body: input },
      );
      if (error) {
        throw new Error(error.message || "validate-iap-receipt failed");
      }
      if (!data?.success) {
        throw new Error(data?.error || "receipt_validation_failed");
      }
      return data;
    },
    onSuccess: (_data, vars) => {
      // Unlock player surfaces: invalidate any access/entitlement query that
      // could gate the curriculum.
      qc.invalidateQueries({ queryKey: ["product-access"] });
      qc.invalidateQueries({ queryKey: ["product-access-by-curriculum", vars.curriculum_id] });
      qc.invalidateQueries({ queryKey: ["entitlements"] });
      qc.invalidateQueries({ queryKey: ["user-entitlements-legacy"] });
      qc.invalidateQueries({ queryKey: ["course-access"] });
      qc.invalidateQueries({ queryKey: ["learner-course-grants"] });
    },
  });
}
