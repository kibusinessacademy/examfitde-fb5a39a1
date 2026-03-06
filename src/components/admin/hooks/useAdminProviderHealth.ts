import { useQuery } from "@tanstack/react-query";
import { adminRpc } from "@/integrations/supabase/admin-rpc";

export function useAdminProviderHealth() {
  return useQuery({
    queryKey: ["admin", "provider-health"],
    queryFn: adminRpc.providerHealth,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
