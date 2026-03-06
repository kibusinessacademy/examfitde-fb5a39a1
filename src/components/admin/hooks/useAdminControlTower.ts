import { useQuery } from "@tanstack/react-query";
import { adminRpc } from "@/integrations/supabase/admin-rpc";

export function useAdminControlTower() {
  return useQuery({
    queryKey: ["admin", "control-tower"],
    queryFn: adminRpc.controlTowerOverview,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
