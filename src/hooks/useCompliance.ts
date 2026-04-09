import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ComplianceDocument {
  id: string;
  doc_type: string;
  title: string;
  content_md: string;
  pdf_path: string | null;
  version: number;
  generated_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useComplianceDocuments() {
  return useQuery({
    queryKey: ["compliance-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_documents" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ComplianceDocument[];
    },
  });
}

export function useDataExportRequests() {
  return useQuery({
    queryKey: ["data-export-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_export_requests" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useExportUserData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { data, error } = await supabase.rpc("fn_export_user_data" as any, {
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Nutzerdaten exportiert");
      qc.invalidateQueries({ queryKey: ["data-export-requests"] });
    },
    onError: (e: Error) => toast.error(`Export fehlgeschlagen: ${e.message}`),
  });
}

export function useDeleteUserData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { data, error } = await supabase.rpc("fn_request_data_deletion" as any, {
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Nutzerdaten anonymisiert/gelöscht");
      qc.invalidateQueries({ queryKey: ["data-export-requests"] });
    },
    onError: (e: Error) => toast.error(`Löschung fehlgeschlagen: ${e.message}`),
  });
}

export function useGenerateComplianceDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { doc_type: string; title: string; content_md: string }) => {
      const { data, error } = await supabase.rpc("fn_generate_compliance_document" as any, {
        p_doc_type: params.doc_type,
        p_title: params.title,
        p_content_md: params.content_md,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Compliance-Dokument erstellt");
      qc.invalidateQueries({ queryKey: ["compliance-documents"] });
    },
    onError: (e: Error) => toast.error(`Fehler: ${e.message}`),
  });
}
