import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RegulatoryUpdate {
  id: string;
  source: string;
  title: string;
  description: string | null;
  affected_topics: string[];
  affected_curriculum_ids: string[];
  severity: string;
  legal_reference: string | null;
  effective_date: string | null;
  detected_at: string;
  processed: boolean;
  processed_at: string | null;
  impact_analysis: any;
  auto_action: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseRegulatoryStatus {
  id: string;
  package_id: string;
  regulatory_status: string;
  last_checked_at: string | null;
  last_update_id: string | null;
  content_version_date: string | null;
  staleness_reason: string | null;
  auto_action_taken: string | null;
  created_at: string;
  updated_at: string;
}

export function useRegulatoryUpdates() {
  return useQuery({
    queryKey: ["regulatory-updates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("regulatory_updates")
        .select("*")
        .order("detected_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as RegulatoryUpdate[];
    },
    refetchInterval: 30000,
  });
}

export function useRegulatoryImpact() {
  return useQuery({
    queryKey: ["regulatory-impact"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_regulatory_status")
        .select("*")
        .neq("regulatory_status", "up_to_date")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CourseRegulatoryStatus[];
    },
    refetchInterval: 30000,
  });
}

export function useRegulatoryAction() {
  const qc = useQueryClient();

  const processUpdates = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("regulatory-monitor", {
        body: { action: "process" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["regulatory-updates"] });
      qc.invalidateQueries({ queryKey: ["regulatory-impact"] });
    },
  });

  const markFalsePositive = useMutation({
    mutationFn: async (updateId: string) => {
      const { error } = await supabase
        .from("regulatory_updates")
        .update({ processed: true, auto_action: "false_positive" } as any)
        .eq("id", updateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["regulatory-updates"] });
    },
  });

  const overrideStatus = useMutation({
    mutationFn: async ({ packageId, status }: { packageId: string; status: string }) => {
      const { error } = await supabase
        .from("course_regulatory_status")
        .update({ regulatory_status: status, updated_at: new Date().toISOString() } as any)
        .eq("package_id", packageId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["regulatory-impact"] });
    },
  });

  return { processUpdates, markFalsePositive, overrideStatus };
}
