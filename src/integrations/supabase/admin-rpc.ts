import { supabase } from "@/integrations/supabase/client";
import type {
  AdminControlTowerResponse,
  DashboardResponse,
  OpsJobItem,
  PackageRiskItem,
  ProviderHealthItem,
  RevenueOverview,
} from "@/components/admin/lib/admin-types";

async function callEdge<T>(fnName: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fnName, {
    body,
  });
  if (error) throw error;
  return data as T;
}

export const adminRpc = {
  controlTowerOverview: () =>
    callEdge<AdminControlTowerResponse>("admin-control-tower", { action: "overview" }),

  opsQueueOverview: () =>
    callEdge<OpsJobItem[]>("admin-control-tower", { action: "ops_queue" }),

  providerHealth: () =>
    callEdge<ProviderHealthItem[]>("admin-control-tower", { action: "provider_health" }),

  packageRiskBoard: () =>
    callEdge<PackageRiskItem[]>("admin-control-tower", { action: "package_risk" }),

  revenueOverview: () =>
    callEdge<RevenueOverview>("admin-control-tower", { action: "revenue" }),

  dashboard: () =>
    callEdge<DashboardResponse>("admin-control-tower", { action: "dashboard" }),
};
