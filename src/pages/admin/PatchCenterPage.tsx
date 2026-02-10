import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  FileText, CheckCircle2, XCircle, Play, RotateCcw, Shield, Loader2, Eye, AlertTriangle
} from "lucide-react";

const STATUS_OPTIONS = ["draft", "validated", "needs_revision", "approved", "rejected", "applied", "failed"] as const;

const statusConfig: Record<string, { color: string; icon: React.ElementType }> = {
  draft: { color: "bg-muted text-muted-foreground", icon: FileText },
  validated: { color: "bg-primary/10 text-primary", icon: Shield },
  needs_revision: { color: "bg-warning/10 text-warning", icon: AlertTriangle },
  approved: { color: "bg-success/10 text-success", icon: CheckCircle2 },
  rejected: { color: "bg-destructive/10 text-destructive", icon: XCircle },
  applied: { color: "bg-success/20 text-success", icon: CheckCircle2 },
  failed: { color: "bg-destructive/20 text-destructive", icon: XCircle },
};

export default function PatchCenterPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["patch-proposals", filter],
    queryFn: async () => {
      const body: Record<string, string> = { action: "list_proposals" };
      if (filter !== "all") body.status = filter;
      const { data, error } = await supabase.functions.invoke("patch-api", { body });
      if (error) throw error;
      return data?.proposals || [];
    },
  });

  const actionMut = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const { data, error } = await supabase.functions.invoke("patch-api", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(`Patch ${vars.action.replace("_proposal", "").replace("_revision", "")} erfolgreich`);
      qc.invalidateQueries({ queryKey: ["patch-proposals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Patch Center
          </h1>
          <p className="text-sm text-muted-foreground">Proposals → Opus Validation → Approve → Apply → Rollback</p>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (data || []).length === 0 ? (
        <Card className="glass-card"><CardContent className="py-8 text-center text-muted-foreground">Keine Patches gefunden.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {(data || []).map((p: Record<string, unknown>) => {
            const st = statusConfig[p.status as string] || statusConfig.draft;
            const StIcon = st.icon;
            return (
              <Card key={p.id as string} className="glass-card">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={st.color}><StIcon className="h-3 w-3 mr-1" />{p.status as string}</Badge>
                        <Badge variant="outline">{p.entity_type as string}</Badge>
                        <Badge variant="secondary">{p.risk as string} risk</Badge>
                        <span className="text-xs text-muted-foreground">{p.council_id as string}</span>
                      </div>
                      <p className="text-sm text-foreground font-medium truncate">{(p.diff_summary as string) || `${p.entity_type} ${(p.entity_id as string)?.slice(0, 8)}…`}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Erstellt: {new Date(p.created_at as string).toLocaleString("de-DE")}
                        {p.validated_at ? ` | Validiert: ${new Date(p.validated_at as string).toLocaleString("de-DE")}` : ""}
                      </p>
                      {p.validator_result && (
                        <details className="mt-2">
                          <summary className="text-xs text-primary cursor-pointer flex items-center gap-1"><Eye className="h-3 w-3" /> Validator Result</summary>
                          <pre className="text-xs bg-muted/30 p-2 rounded mt-1 max-h-40 overflow-auto">{JSON.stringify(p.validator_result, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {p.status === "draft" && (
                        <Button size="sm" variant="outline" disabled={actionMut.isPending}
                          onClick={() => actionMut.mutate({ action: "validate_proposal", patchId: p.id as string, mode: "quick" })}>
                          <Shield className="h-3.5 w-3.5 mr-1" /> Validate
                        </Button>
                      )}
                      {(p.status === "validated" || p.status === "needs_revision") && (
                        <>
                          <Button size="sm" disabled={actionMut.isPending}
                            onClick={() => actionMut.mutate({ action: "approve_proposal", patchId: p.id as string })}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" disabled={actionMut.isPending}
                            onClick={() => actionMut.mutate({ action: "reject_proposal", patchId: p.id as string })}>
                            <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {p.status === "approved" && (
                        <Button size="sm" disabled={actionMut.isPending}
                          onClick={() => actionMut.mutate({ action: "apply_proposal", patchId: p.id as string })}>
                          <Play className="h-3.5 w-3.5 mr-1" /> Apply
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
