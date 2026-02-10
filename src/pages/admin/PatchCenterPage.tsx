import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, XCircle, Wand2, Play, Undo2, Eye, RefreshCw, FileDiff,
} from "lucide-react";

type PatchStatus = "draft" | "validated" | "needs_revision" | "approved" | "rejected" | "applied" | "failed";

type PatchProposal = {
  id: string;
  council_id: string;
  entity_type: string;
  entity_id: string;
  status: PatchStatus;
  risk: "low" | "medium" | "high";
  diff_summary: string | null;
  validator_result: any | null;
  validated_at: string | null;
  approved_at: string | null;
  applied_at: string | null;
  apply_error: string | null;
  before: any;
  after: any;
  created_at: string;
  updated_at: string;
};

type PatchRevision = {
  id: string;
  patch_id: string;
  entity_type: string;
  entity_id: string;
  applied_at: string;
  applied_by: string | null;
  rollback_of: string | null;
  before: any;
  after: any;
};

const statusBadge = (s: PatchStatus) => {
  const base = "border";
  if (s === "approved") return <Badge className={`bg-success/10 text-success border-success/30 ${base}`}>approved</Badge>;
  if (s === "validated") return <Badge className={`bg-success/10 text-success border-success/30 ${base}`}>validated</Badge>;
  if (s === "needs_revision") return <Badge className={`bg-warning/10 text-warning border-warning/30 ${base}`}>needs revision</Badge>;
  if (s === "draft") return <Badge variant="outline">draft</Badge>;
  if (s === "rejected") return <Badge className={`bg-destructive/10 text-destructive border-destructive/30 ${base}`}>rejected</Badge>;
  if (s === "applied") return <Badge className={`bg-success/10 text-success border-success/30 ${base}`}>applied</Badge>;
  if (s === "failed") return <Badge className={`bg-destructive/10 text-destructive border-destructive/30 ${base}`}>failed</Badge>;
  return <Badge variant="outline">{s}</Badge>;
};

const riskBadge = (r: string) => {
  if (r === "high") return <Badge className="bg-destructive/10 text-destructive border-destructive/30">high</Badge>;
  if (r === "medium") return <Badge className="bg-warning/10 text-warning border-warning/30">medium</Badge>;
  return <Badge className="bg-success/10 text-success border-success/30">low</Badge>;
};

function fmt(dt?: string | null) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString("de-DE");
}

function defaultValidationMode(entityType: string) {
  switch (entityType) {
    case "lesson": return "lesson";
    case "course": return "course";
    case "question": return "question";
    case "blog": return "blog_article";
    case "tutor_response": return "tutor_response";
    default: return "lesson";
  }
}

export default function PatchCenterPage() {
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<PatchStatus | "all">("all");
  const [councilFilter, setCouncilFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");

  const [selected, setSelected] = useState<PatchProposal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [validationMode, setValidationMode] = useState<string>("lesson");

  const { data: patches, isLoading, refetch } = useQuery({
    queryKey: ["patch-proposals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patch_proposals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as PatchProposal[];
    },
    refetchInterval: 20_000,
  });

  const { data: revisions } = useQuery({
    queryKey: ["patch-revisions", selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patch_revisions")
        .select("*")
        .eq("patch_id", selected!.id)
        .order("applied_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PatchRevision[];
    },
  });

  const councils = useMemo(() => {
    const set = new Set((patches ?? []).map(p => p.council_id).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [patches]);

  const entityTypes = useMemo(() => {
    const set = new Set((patches ?? []).map(p => p.entity_type).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [patches]);

  const filtered = useMemo(() => {
    return (patches ?? []).filter(p => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (councilFilter !== "all" && p.council_id !== councilFilter) return false;
      if (entityFilter !== "all" && p.entity_type !== entityFilter) return false;
      return true;
    });
  }, [patches, statusFilter, councilFilter, entityFilter]);

  const invoke = async (body: Record<string, string>) => {
    const { data, error } = await supabase.functions.invoke("patch-api", { body });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data;
  };

  const validatePatch = useMutation({
    mutationFn: ({ patchId, mode }: { patchId: string; mode: string }) =>
      invoke({ action: "validate_proposal", patchId, mode }),
    onSuccess: () => { toast.success("Validierung abgeschlossen (Opus)"); qc.invalidateQueries({ queryKey: ["patch-proposals"] }); },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  const approvePatch = useMutation({
    mutationFn: (patchId: string) => invoke({ action: "approve_proposal", patchId }),
    onSuccess: () => { toast.success("Patch approved"); qc.invalidateQueries({ queryKey: ["patch-proposals"] }); },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  const rejectPatch = useMutation({
    mutationFn: (patchId: string) => invoke({ action: "reject_proposal", patchId }),
    onSuccess: () => { toast.success("Patch rejected"); qc.invalidateQueries({ queryKey: ["patch-proposals"] }); },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  const applyPatch = useMutation({
    mutationFn: (patchId: string) => invoke({ action: "apply_proposal", patchId }),
    onSuccess: () => {
      toast.success("Patch applied ✅");
      qc.invalidateQueries({ queryKey: ["patch-proposals"] });
      qc.invalidateQueries({ queryKey: ["patch-revisions", selected?.id] });
    },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  const rollbackMut = useMutation({
    mutationFn: (revisionId: string) => invoke({ action: "rollback_revision", revisionId }),
    onSuccess: () => {
      toast.success("Rollback erfolgreich");
      qc.invalidateQueries({ queryKey: ["patch-proposals"] });
      qc.invalidateQueries({ queryKey: ["patch-revisions", selected?.id] });
    },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  const busy = validatePatch.isPending || approvePatch.isPending || rejectPatch.isPending || applyPatch.isPending || rollbackMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold">Patch Center</h1>
          <p className="text-sm text-muted-foreground">
            Proposal → Opus Validation → Approval → Apply → Rollback (SSOT-safe, auditierbar)
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Aktualisieren
        </Button>
      </div>

      <Card className="glass-card">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileDiff className="h-4 w-4" /> Patch Queue
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <TabsList>
                {["all","draft","validated","needs_revision","approved","applied","rejected","failed"].map(s => (
                  <TabsTrigger key={s} value={s}>{s}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Select value={councilFilter} onValueChange={setCouncilFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Council" /></SelectTrigger>
              <SelectContent>{councils.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Entity" /></SelectTrigger>
              <SelectContent>{entityTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {(patches ?? []).length}</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Lade…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">Keine Patches im Filter.</div>
          ) : filtered.map((p) => (
            <div key={p.id} className="p-3 rounded-lg border border-border bg-muted/20">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{p.council_id}</Badge>
                    <Badge variant="outline">{p.entity_type}</Badge>
                    {statusBadge(p.status)}
                    {riskBadge(p.risk)}
                    <span className="text-xs text-muted-foreground">{fmt(p.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium mt-2 break-words">
                    {p.diff_summary || `Patch ${p.entity_type}:${p.entity_id}`}
                  </p>
                  {p.apply_error && <p className="text-xs mt-1 text-destructive break-words">Fehler: {p.apply_error}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => { setSelected(p); setValidationMode(defaultValidationMode(p.entity_type)); setDetailOpen(true); }}>
                  <Eye className="h-4 w-4 mr-1" /> Details
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><FileDiff className="h-4 w-4" /> Patch Details</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{selected.council_id}</Badge>
                  <Badge variant="outline">{selected.entity_type}</Badge>
                  {statusBadge(selected.status)}
                  {riskBadge(selected.risk)}
                  <span className="text-xs text-muted-foreground">validated: {fmt(selected.validated_at)}</span>
                  <span className="text-xs text-muted-foreground">approved: {fmt(selected.approved_at)}</span>
                  <span className="text-xs text-muted-foreground">applied: {fmt(selected.applied_at)}</span>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={validationMode} onValueChange={setValidationMode}>
                    <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["lesson","course","question","tutor_response","blog_article"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" disabled={busy} onClick={() => validatePatch.mutate({ patchId: selected.id, mode: validationMode })}>
                    {validatePatch.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />} Validate
                  </Button>
                  <Button disabled={busy || selected.status !== "validated"} onClick={() => approvePatch.mutate(selected.id)}>
                    {approvePatch.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} Approve
                  </Button>
                  <Button variant="outline" disabled={busy || selected.status === "applied"} onClick={() => rejectPatch.mutate(selected.id)}>
                    {rejectPatch.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />} Reject
                  </Button>
                  <Button variant="secondary" disabled={busy || selected.status !== "approved"} onClick={() => applyPatch.mutate(selected.id)}>
                    {applyPatch.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />} Apply
                  </Button>
                </div>

                {/* Validator Result */}
                <Card className="glass-card">
                  <CardHeader><CardTitle className="text-sm">Validator Result (Opus)</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="text-xs whitespace-pre-wrap break-words bg-muted/30 p-3 rounded-md border max-h-60 overflow-auto">
                      {JSON.stringify(selected.validator_result ?? {}, null, 2)}
                    </pre>
                  </CardContent>
                </Card>

                {/* Before / After */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Card className="glass-card">
                    <CardHeader><CardTitle className="text-sm">Before</CardTitle></CardHeader>
                    <CardContent>
                      <pre className="text-xs whitespace-pre-wrap break-words bg-muted/30 p-3 rounded-md border max-h-[360px] overflow-auto">
                        {JSON.stringify(selected.before ?? {}, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                  <Card className="glass-card">
                    <CardHeader><CardTitle className="text-sm">After</CardTitle></CardHeader>
                    <CardContent>
                      <pre className="text-xs whitespace-pre-wrap break-words bg-muted/30 p-3 rounded-md border max-h-[360px] overflow-auto">
                        {JSON.stringify(selected.after ?? {}, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </div>

                {/* Revisions */}
                <Card className="glass-card">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2"><Undo2 className="h-4 w-4" /> Revisions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {!revisions || revisions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Keine Revisions vorhanden.</p>
                    ) : revisions.map((rev) => (
                      <div key={rev.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 border border-border text-xs">
                        <div className="space-y-0.5">
                          <p className="text-foreground font-medium">
                            {rev.entity_type} · {rev.entity_id.slice(0, 8)}…
                            {rev.rollback_of && <Badge variant="secondary" className="ml-2 text-[10px]">Rollback</Badge>}
                          </p>
                          <p className="text-muted-foreground">{fmt(rev.applied_at)}</p>
                        </div>
                        {!rev.rollback_of && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => rollbackMut.mutate(rev.id)}>
                            <Undo2 className="h-3 w-3 mr-1" /> Rollback
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}