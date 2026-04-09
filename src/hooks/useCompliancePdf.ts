import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useGenerateCompliancePdf() {
  return useMutation({
    mutationFn: async (docId: string) => {
      const { data, error } = await supabase.functions.invoke("compliance-doc-pdf", {
        body: { docId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "PDF generation failed");
      return data as { ok: true; docId: string; pdf_path: string; signed_url: string };
    },
    onSuccess: (data) => {
      toast.success("PDF erstellt");
      // Open PDF in new tab
      window.open(data.signed_url, "_blank");
    },
    onError: (e: Error) => toast.error(`PDF-Fehler: ${e.message}`),
  });
}
