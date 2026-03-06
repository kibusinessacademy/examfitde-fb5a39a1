import { useQuery } from "@tanstack/react-query";
import { adminRpc } from "@/integrations/supabase/admin-rpc";

export function useAdminOpsQueue() {
  return useQuery({
    queryKey: ["admin", "ops-queue"],
    queryFn: adminRpc.opsQueueOverview,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
