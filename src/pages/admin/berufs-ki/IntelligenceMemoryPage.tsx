import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listIntelligenceMemory,
  recordIntelligenceMemory,
  retireIntelligenceMemory,
  listBusinessIntents,
  type IntelligenceMemoryEntry,
  type IntelligenceMemoryKind,
  type IntelligenceMemoryStatus,
} from "@/lib/berufs-ki/outcome";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Brain, Archive, Link2, Tag } from "lucide-react";

const KIND_LABEL: Record<IntelligenceMemoryKind, string> = {
  successful_pattern: "Erfolgreiches Pattern",
  quality_issue: "Quality Issue",
  risk_incident: "Risk Incident",
  conversion_learning: "Conversion Learning",
  ux_learning: "UX Learning",
  seo_learning: "SEO Learning",
  workflow_failure: "Workflow Failure",
  security_pattern: "Security Pattern",
  architecture_decision: "Architektur-Entscheidung",
};

const KIND_TONE: Record<IntelligenceMemoryKind, string> = {
  successful_pattern: "bg-status-success-subtle text-status-success-foreground",
  quality_issue: "bg-status-warning-subtle text-status-warning-foreground",
  risk_incident: "bg-status-danger-subtle text-status-danger-foreground",
  conversion_learning: "bg-primary/10 text-primary",
  ux_learning: "bg-accent/10 text-accent-foreground",
  seo_learning: "bg-secondary/30 text-secondary-foreground",
  workflow_failure: "bg-status-danger-subtle text-status-danger-foreground",
  security_pattern: "bg-status-warning-subtle text-status-warning-foreground",
  architecture_decision: "bg-muted text-muted-foreground",
};

const STATUS_TONE: Record<IntelligenceMemoryStatus, string> = {
  active: "bg-status-success-subtle text-status-success-foreground",
  retired: "bg-muted text-muted-foreground",
  superseded: "bg-status-warning-subtle text-status-warning-foreground",
};

const KIND_OPTIONS: IntelligenceMemoryKind[] = [
  "successful_pattern", "quality_issue", "risk_incident", "conversion_learning",
  "ux_learning", "seo_learning", "workflow_failure", "security_pattern", "architecture_decision",
];

function RecordDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data: intents } = useQuery({
    queryKey: ["business-intents-min"],
    queryFn: () => listBusinessIntents(),
    enabled: open,
  });
  const [form, setForm] = useState({
    memory_key: "",
    kind: "successful_pattern" as IntelligenceMemoryKind,
    vertical_key: "",
    title: "",
    summary: "",
    confidence: "0.7",
    business_intent_id: "",
    tags: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      recordIntelligenceMemory({
        memory_key: form.memory_key.trim(),
        kind: form.kind,
        title: form.title.trim(),
        summary: form.summary.trim(),
        vertical_key: form.vertical_key.trim() || null,
        confidence: Number(form.confidence) || 0.5,
        business_intent_id: form.business_intent_id || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      toast({ title: "Memory aufgezeichnet", description: form.memory_key });
      setOpen(false);
      setForm({ memory_key: "", kind: "successful_pattern", vertical_key: "", title: "",
        summary: "", confidence: "0.7", business_intent_id: "", tags: "" });
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const valid = form.memory_key.length >= 3 && form.title.length >= 4 && form.summary.length >= 8;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Neues Memory</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Persistent Intelligence Memory aufzeichnen</DialogTitle>
          <CardDescription>
            Dauerhafte Lernschicht: Patterns, Probleme, Risiken, Architektur-Entscheidungen — abrufbar für künftige Agent-Runs.
          </CardDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="memory_key">Memory Key *</Label>
              <Input id="memory_key" placeholder="z.B. council_pass_rate_above_85"
                value={form.memory_key} onChange={(e) => setForm({ ...form, memory_key: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Kind *</Label>
              <Select value={form.kind} onValueChange={(v: IntelligenceMemoryKind) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Titel *</Label>
            <Input id="title" placeholder="Kurzer Titel des Learnings"
              value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="summary">Summary * (mind. 8 Zeichen)</Label>
            <Textarea id="summary" rows={4}
              placeholder="Was wurde gelernt? Welcher Pattern/Risiko/Entscheidung steckt dahinter?"
              value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vertical">Vertical Key</Label>
              <Input id="vertical" placeholder="optional"
                value={form.vertical_key} onChange={(e) => setForm({ ...form, vertical_key: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confidence">Confidence (0–1)</Label>
              <Input id="confidence" type="number" step="0.05" min="0" max="1"
                value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Business Intent</Label>
              <Select value={form.business_intent_id || "none"} onValueChange={(v) => setForm({ ...form, business_intent_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— keines —</SelectItem>
                  {(intents ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags (kommasepariert)</Label>
            <Input id="tags" placeholder="z.B. council, bronze, repair"
              value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Speichere…" : "Aufzeichnen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemoryCard({ entry, onChanged }: { entry: IntelligenceMemoryEntry; onChanged: () => void }) {
  const { toast } = useToast();
  const retireMutation = useMutation({
    mutationFn: (reason: string) => retireIntelligenceMemory(entry.id, reason),
    onSuccess: () => { toast({ title: "Memory archiviert" }); onChanged(); },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const handleRetire = () => {
    const reason = window.prompt("Warum archivieren? (mind. 5 Zeichen)");
    if (reason && reason.trim().length >= 5) retireMutation.mutate(reason.trim());
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{entry.title}</CardTitle>
            <CardDescription className="font-mono text-xs mt-1 truncate">{entry.memory_key}</CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0">
            <Badge className={KIND_TONE[entry.kind]} variant="secondary">{KIND_LABEL[entry.kind]}</Badge>
            <Badge className={STATUS_TONE[entry.status]} variant="secondary">{entry.status}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-foreground leading-relaxed whitespace-pre-wrap">{entry.summary}</p>
        <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
          {entry.vertical_key && <span className="font-mono">{entry.vertical_key}</span>}
          <span>Confidence: <strong className="text-foreground">{(entry.confidence * 100).toFixed(0)}%</strong></span>
          {entry.intent_title && (
            <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />{entry.intent_title}</span>
          )}
        </div>
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-xs"><Tag className="mr-1 h-3 w-3" />{t}</Badge>
            ))}
          </div>
        )}
        {entry.status === "active" && (
          <div className="pt-2 border-t border-border flex justify-end">
            <Button size="sm" variant="ghost" onClick={handleRetire} disabled={retireMutation.isPending}>
              <Archive className="mr-1 h-3 w-3" />Archivieren
            </Button>
          </div>
        )}
        {entry.retired_reason && (
          <p className="text-xs text-muted-foreground italic">Archiviert: {entry.retired_reason}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function IntelligenceMemoryPage() {
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = useState<IntelligenceMemoryKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<IntelligenceMemoryStatus | "all">("active");

  const { data, isLoading, error } = useQuery({
    queryKey: ["intelligence-memory", kindFilter, statusFilter],
    queryFn: () => listIntelligenceMemory({
      kind: kindFilter === "all" ? null : kindFilter,
      status: statusFilter === "all" ? null : statusFilter,
    }),
  });

  useEffect(() => { document.title = "Intelligence Memory — BerufAgentOS"; }, []);

  const refresh = () => qc.invalidateQueries({ queryKey: ["intelligence-memory"] });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-7 w-7 text-primary" /> Persistent Intelligence Memory
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Dauerhafte Lernschicht von BerufAgentOS — erfolgreiche Patterns, Quality Issues, Risk Incidents,
            UX-/SEO-/Conversion-Learnings, Workflow-Failures, Security- und Architektur-Entscheidungen.
            Fundament für Continuous Intelligence (Fix-Loops folgen in Cut 2.4).
          </p>
        </div>
        <RecordDialog onCreated={refresh} />
      </header>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Kind</Label>
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as IntelligenceMemoryKind | "all")}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              {KIND_OPTIONS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as IntelligenceMemoryStatus | "all")}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
              <SelectItem value="superseded">Superseded</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive">
            Fehler beim Laden: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="pt-10 pb-10 text-center space-y-3">
            <Brain className="mx-auto h-10 w-10 text-muted-foreground" />
            <CardTitle className="text-lg">Noch keine Memories</CardTitle>
            <CardDescription>
              Beginne mit dem ersten Pattern oder der ersten Architektur-Entscheidung.
              Jedes Memory wird ab Cut 2.3 in Outcome-Runs als "Prior Learning" einbezogen.
            </CardDescription>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((entry) => <MemoryCard key={entry.id} entry={entry} onChanged={refresh} />)}
        </div>
      )}
    </div>
  );
}
