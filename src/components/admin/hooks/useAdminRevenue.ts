import { useQuery } from "@tanstack/react-query";
import { adminRpc } from "@/integrations/supabase/admin-rpc";

export function useAdminRevenue() {
  return useQuery({
    queryKey: ["admin", "revenue"],
    queryFn: adminRpc.revenueOverview,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
