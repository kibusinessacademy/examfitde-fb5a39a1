import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useFactoryExecutiveReport() {
  return useQuery({
    queryKey: ["factory-executive"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "admin-factory-executive",
      );
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });
}
