import { useQuery } from "@tanstack/react-query";
import { adminRpc } from "@/integrations/supabase/admin-rpc";

export function useAdminPackageRisk() {
  return useQuery({
    queryKey: ["admin", "package-risk"],
    queryFn: adminRpc.packageRiskBoard,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
