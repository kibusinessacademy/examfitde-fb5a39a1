/**
 * BerufAgentOS v2 — Cut 2.3 Continuous Outcome Intelligence
 *
 * Mission-Control für interpretierte Beobachtungen.
 * Strikt READ-ONLY auf Workflows — nur Detection/Interpretation/Priorisierung.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { AlertCircle, Activity, Loader2, Plus, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  listOutcomeIntelligence,
  getOutcomeIntelligenceSummary,
  recordOutcomeIntelligence,
  classifyOutcomeIntelligence,
  type OutcomeIntelligenceFinding,
  type OutcomeIntelligenceKind,
  type OutcomeIntelligenceSeverity,
  type OutcomeIntelligenceStatus,
  type OutcomeIntelligenceSummary,
} from "@/lib/berufs-ki/outcome";

const KIND_LABEL: Record<OutcomeIntelligenceKind, string> = {
  workflow_intelligence: "Workflow",
  outcome_drift: "Outcome-Drift",
  ux_friction: "UX-Friction",
  governance_risk: "Governance-Risiko",
  seo_intelligence: "SEO",
  support_signal: "Support-Signal",
};

const SEVERITY_TONE: Record<OutcomeIntelligenceSeverity, string> = {
  info: "bg-status-info-subtle text-status-info border-status-info/30",
  low: "bg-status-info-subtle text-status-info border-status-info/30",
  medium: "bg-status-warning-subtle text-status-warning border-status-warning/30",
  high: "bg-status-warning-subtle text-status-warning border-status-warning/40",
  critical: "bg-status-error-subtle text-status-error border-status-error/40",
};

function ImpactCard({
  finding,
  onClassify,
}: {
  finding: OutcomeIntelligenceFinding;
  onClassify: (id: string, next: OutcomeIntelligenceStatus) => void;
}) {
  const scopeAreas = (finding.affected_scope?.areas as string[] | undefined) ?? [];
  return (
    <Card className="border-border-subtle shadow-elev-1">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{KIND_LABEL[finding.kind]}</Badge>
              <Badge className={`text-xs border ${SEVERITY_TONE[finding.severity]}`}>
                {finding.severity}
              </Badge>
              <Badge variant="outline" className="text-xs text-text-muted">
                Prio {finding.priority_score.toFixed(2)}
              </Badge>
              {finding.status !== "open" && (
                <Badge variant="secondary" className="text-xs">{finding.status}</Badge>
              )}
            </div>
            <CardTitle className="text-base">{finding.title}</CardTitle>
            <p className="text-xs text-text-muted">
              {finding.vertical_key}
              {finding.business_intent_title ? ` · Intent: ${finding.business_intent_title}` : ""}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-default leading-relaxed">{finding.interpretation}</p>

        {scopeAreas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {scopeAreas.map((a) => (
              <Badge key={a} variant="outline" className="text-xs">Betroffen: {a}</Badge>
            ))}
          </div>
        )}

        {finding.recommended_inspection && (
          <div className="rounded-md border border-border-subtle bg-surface-subtle p-3">
            <p className="text-xs font-medium text-text-muted mb-1">Empfohlene Prüfung</p>
            <p className="text-sm text-text-default">{finding.recommended_inspection}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-text-muted">Vertrauen</div>
            <div className="font-medium">{(finding.confidence_score * 100).toFixed(0)}%</div>
          </div>
          <div>
            <div className="text-text-muted">Schwere</div>
            <div className="font-medium">{(finding.severity_score * 100).toFixed(0)}%</div>
          </div>
          <div>
            <div className="text-text-muted">Geschäftswirkung</div>
            <div className="font-medium">{(finding.business_impact_score * 100).toFixed(0)}%</div>
          </div>
        </div>

        {finding.status === "open" && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm" variant="outline"
              onClick={() => onClassify(finding.id, "acknowledged")}
            >
              Bestätigen
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => onClassify(finding.id, "muted")}
            >
              Stumm schalten
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => onClassify(finding.id, "resolved_observed")}
            >
              Beobachtet · gelöst
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecordDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    finding_key: "",
    kind: "workflow_intelligence" as OutcomeIntelligenceKind,
    vertical_key: "",
    title: "",
    interpretation: "",
    recommended_inspection: "",
    severity: "medium" as OutcomeIntelligenceSeverity,
    confidence_score: 0.7,
    severity_score: 0.6,
    business_impact_score: 0.6,
  });

  const submit = async () => {
    if (!form.finding_key || !form.title || form.interpretation.length < 12 || !form.vertical_key) {
      toast({ title: "Pflichtfelder fehlen", description: "Key, Vertical, Titel und Interpretation (≥12 Z.) erforderlich.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await recordOutcomeIntelligence({
        findingKey: form.finding_key,
        kind: form.kind,
        verticalKey: form.vertical_key,
        title: form.title,
        interpretation: form.interpretation,
        recommendedInspection: form.recommended_inspection || undefined,
        severity: form.severity,
        confidenceScore: form.confidence_score,
        severityScore: form.severity_score,
        businessImpactScore: form.business_impact_score,
      });
      toast({ title: "Finding erfasst" });
      setOpen(false);
      onCreated();
    } catch (e) {
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Finding erfassen</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Outcome-Intelligence-Finding erfassen</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Finding-Key (stabil, eindeutig)</Label>
            <Input
              value={form.finding_key}
              onChange={(e) => setForm({ ...form, finding_key: e.target.value })}
              placeholder="z. B. workflow_sla_drift_hausverw_objekt_nord"
            />
          </div>
          <div>
            <Label>Art</Label>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as OutcomeIntelligenceKind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vertical-Key</Label>
            <Input value={form.vertical_key} onChange={(e) => setForm({ ...form, vertical_key: e.target.value })} placeholder="hausverwaltung" />
          </div>
          <div className="col-span-2">
            <Label>Titel</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Schadensmeldungen +43 % Bearbeitungszeit" />
          </div>
          <div className="col-span-2">
            <Label>Interpretation (≥12 Z., kein KPI-Dump)</Label>
            <Textarea
              rows={3}
              value={form.interpretation}
              onChange={(e) => setForm({ ...form, interpretation: e.target.value })}
              placeholder="Erhöhtes Eskalationsrisiko: Schadensmeldungen bleiben aktuell 43 % länger offen als im 30-Tage-Schnitt. Betroffen: Objektgruppe Nord."
            />
          </div>
          <div className="col-span-2">
            <Label>Empfohlene Prüfung</Label>
            <Textarea
              rows={2}
              value={form.recommended_inspection}
              onChange={(e) => setForm({ ...form, recommended_inspection: e.target.value })}
              placeholder="Workflow-Zuweisung + Dienstleister-Latenz prüfen"
            />
          </div>
          <div>
            <Label>Schweregrad</Label>
            <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as OutcomeIntelligenceSeverity })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["info","low","medium","high","critical"] as OutcomeIntelligenceSeverity[]).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vertrauen (0–1)</Label>
            <Input type="number" step="0.1" min="0" max="1" value={form.confidence_score}
              onChange={(e) => setForm({ ...form, confidence_score: parseFloat(e.target.value) })} />
          </div>
          <div>
            <Label>Schwere-Score (0–1)</Label>
            <Input type="number" step="0.1" min="0" max="1" value={form.severity_score}
              onChange={(e) => setForm({ ...form, severity_score: parseFloat(e.target.value) })} />
          </div>
          <div>
            <Label>Geschäftswirkung (0–1)</Label>
            <Input type="number" step="0.1" min="0" max="1" value={form.business_impact_score}
              onChange={(e) => setForm({ ...form, business_impact_score: parseFloat(e.target.value) })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Erfassen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OutcomeIntelligencePage() {
  const [summary, setSummary] = useState<OutcomeIntelligenceSummary | null>(null);
  const [findings, setFindings] = useState<OutcomeIntelligenceFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<OutcomeIntelligenceKind | "all">("all");
  const [filterStatus, setFilterStatus] = useState<OutcomeIntelligenceStatus | "all">("open");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, list] = await Promise.all([
        getOutcomeIntelligenceSummary(),
        listOutcomeIntelligence({
          kind: filterKind === "all" ? null : filterKind,
          status: filterStatus === "all" ? null : filterStatus,
          limit: 200,
        }),
      ]);
      setSummary(s);
      setFindings(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterKind, filterStatus]);

  const handleClassify = async (id: string, next: OutcomeIntelligenceStatus) => {
    const reason = window.prompt("Grund für Statuswechsel (≥5 Zeichen)?");
    if (!reason || reason.length < 5) return;
    try {
      await classifyOutcomeIntelligence(id, next, reason);
      toast({ title: "Status aktualisiert" });
      load();
    } catch (e) {
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    }
  };

  const kindTiles = useMemo(() => summary?.by_kind ?? [], [summary]);

  return (
    <div className="container max-w-7xl mx-auto py-8 space-y-6">
      <Helmet><title>Outcome Intelligence · BerufAgentOS</title></Helmet>

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-text-muted text-xs uppercase tracking-wider">
            <Radar className="h-3.5 w-3.5" /> Mission Control · Cut 2.3
          </div>
          <h1 className="text-3xl font-semibold mt-1">Continuous Outcome Intelligence</h1>
          <p className="text-text-muted mt-1 max-w-2xl">
            Interpretierte Beobachtungen über Workflow-, Outcome-, UX-, Governance-, SEO- und Support-Drift.
            Strikt read-only — keine autonomen Änderungen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/admin/berufs-ki/fix-queue">Operations Review Center →</a>
          </Button>
          <RecordDialog onCreated={load} />
        </div>
      </header>

      {/* Outcome Radar — KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-border-subtle"><CardContent className="pt-4">
          <div className="text-xs text-text-muted">Offen gesamt</div>
          <div className="text-2xl font-semibold">{summary?.total_open ?? "–"}</div>
        </CardContent></Card>
        <Card className="border-border-subtle"><CardContent className="pt-4">
          <div className="text-xs text-text-muted">Kritisch</div>
          <div className="text-2xl font-semibold text-status-error">{summary?.critical_open ?? "–"}</div>
        </CardContent></Card>
        <Card className="border-border-subtle"><CardContent className="pt-4">
          <div className="text-xs text-text-muted">Hoch</div>
          <div className="text-2xl font-semibold text-status-warning">{summary?.high_open ?? "–"}</div>
        </CardContent></Card>
        <Card className="border-border-subtle"><CardContent className="pt-4">
          <div className="text-xs text-text-muted">Ø Priorität</div>
          <div className="text-2xl font-semibold">{summary?.avg_priority?.toFixed(2) ?? "–"}</div>
        </CardContent></Card>
        <Card className="border-border-subtle"><CardContent className="pt-4">
          <div className="text-xs text-text-muted">Neu · 24 h / 7 d</div>
          <div className="text-2xl font-semibold">{summary?.recent_24h ?? 0} / {summary?.recent_7d ?? 0}</div>
        </CardContent></Card>
      </div>

      {/* Kind distribution */}
      {kindTiles.length > 0 && (
        <Card className="border-border-subtle">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Verteilung nach Art</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {kindTiles.map((k) => (
                <Badge key={k.kind} variant="outline" className="text-xs">
                  {KIND_LABEL[k.kind as OutcomeIntelligenceKind] ?? k.kind} · {k.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-[180px]">
          <Label className="text-xs">Art</Label>
          <Select value={filterKind} onValueChange={(v) => setFilterKind(v as typeof filterKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <SelectItem key={k} value={k}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Label className="text-xs">Status</Label>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="open">Offen</SelectItem>
              <SelectItem value="acknowledged">Bestätigt</SelectItem>
              <SelectItem value="muted">Stumm</SelectItem>
              <SelectItem value="resolved_observed">Beobachtet gelöst</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Intelligence Timeline */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Lade Findings…
        </div>
      )}
      {error && (
        <Card className="border-status-error/30 bg-status-error-subtle">
          <CardContent className="pt-4 flex items-center gap-2 text-status-error">
            <AlertCircle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}
      {!loading && !error && findings.length === 0 && (
        <Card className="border-dashed border-border-subtle">
          <CardContent className="pt-8 pb-8 text-center text-text-muted">
            Noch keine Findings erfasst. Lege das erste manuell an oder warte auf den ersten Detector-Lauf (Cut 2.4+).
          </CardContent>
        </Card>
      )}
      {!loading && !error && findings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {findings.map((f) => (
            <ImpactCard key={f.id} finding={f} onClassify={handleClassify} />
          ))}
        </div>
      )}
    </div>
  );
}
