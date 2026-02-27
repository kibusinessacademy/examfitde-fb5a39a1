import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  curriculumId: string;
  disabled?: boolean;
}

export function SongExportButton({ curriculumId, disabled }: Props) {
  const [loading, setLoading] = useState(false);

  const handleExport = async (format: "json" | "csv") => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-learning-field-songs", {
        body: { curriculum_id: curriculumId, format },
      });

      if (error) throw error;

      if (format === "csv") {
        // data is text for CSV
        const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data)], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `songs-${curriculumId.slice(0, 8)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success("CSV exportiert");
      } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `songs-${curriculumId.slice(0, 8)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success(`${data.count} Songs als JSON exportiert`);
      }
    } catch (err) {
      toast.error("Export fehlgeschlagen: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-1">
      <Button variant="outline" size="sm" onClick={() => handleExport("json")} disabled={disabled || loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
        JSON
      </Button>
      <Button variant="outline" size="sm" onClick={() => handleExport("csv")} disabled={disabled || loading}>
        CSV
      </Button>
    </div>
  );
}
