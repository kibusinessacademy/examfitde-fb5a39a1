import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

async function callSupervisor(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-production-supervisor", {
    body,
  });
  if (error) throw error;
  return data;
}

async function callSeed(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-seed-production-wave", {
    body,
  });
  if (error) throw error;
  return data;
}

export function useProductionWaveStatus() {
  return useQuery({
    queryKey: ["production-wave-status"],
    queryFn: () => callSupervisor({ action: "status" }),
    refetchInterval: 15000,
  });
}

export function useSeedProductionWave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: callSeed,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-wave-status"] });
    },
  });
}

export function useWaveAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: callSupervisor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-wave-status"] });
    },
  });
}
