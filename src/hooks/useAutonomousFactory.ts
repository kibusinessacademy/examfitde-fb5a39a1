import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRunAutonomousFactory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "admin-run-autonomous-factory",
        { body: {} },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory-executive"] });
      qc.invalidateQueries({ queryKey: ["production-wave-status"] });
    },
  });
}
