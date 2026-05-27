/**
 * BerufAgentOS v2 — Cut 2.5 Persona Simulation Layer (HITL-only)
 *
 * Decision Intelligence VOR Human Approval:
 *   Detection → Proposal (2.4) → Persona-Simulation (2.5) → Review-Entscheidung (2.4)
 *
 * STRIKT KEIN AUTO-APPLY. KEINE WORKFLOW-MUTATION. KEIN SELF-HEAL.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, GitPullRequest, Loader2, ShieldAlert,
  Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  listFixProposals,
  type OutcomeFixProposal,
} from "@/lib/berufs-ki/outcome";
import {
  listPersonas, getPersonaSimulations, simulateProposalPersona,
  clearPersonaSimulation, getPersonaConflictMatrix,
  type PersonaRegistryEntry, type PersonaSimulation,
  type PersonaMatrixRow, type PersonaKey,
} from "@/lib/berufs-ki/outcome";

const RISK_TONE: Record<string, string> = {
  high: "bg-status-error-subtle text-status-error border-status-error/30",
  medium: "bg-status-warn-subtle text-status-warn border-status-warn/30",
  low: "bg-status-success-subtle text-status-success border-status-success/30",
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.7
    ? "bg-status-success"
    : value >= 0.4
    ? "bg-status-warn"
    : "bg-status-error";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>{label}</span>
        <span className="font-mono text-text-primary">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-surface-muted">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PersonaSimulationPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [personas, setPersonas] = useState<PersonaRegistryEntry[]>([]);
  const [proposals, setProposals] = useState<OutcomeFixProposal[]>([]);
  const [matrix, setMatrix] = useState<PersonaMatrixRow[]>([]);
  const [onlyConflicts, setOnlyConflicts] = useState(false);

  const [selected, setSelected] = useState<OutcomeFixProposal | null>(null);
  const [selSims, setSelSims] = useState<PersonaSimulation[]>([]);
  const [selLoading, setSelLoading] = useState(false);

  const [simDialog, setSimDialog] = useState<{
    open: boolean; personaKey: PersonaKey | null;
    utility: number; risk: number; comprehension: number; conversion: number;
    rationale: string; submitting: boolean;
  }>({
    open: false, personaKey: null,
    utility: 0.5, risk: 0.5, comprehension: 0.5, conversion: 0.5,
    rationale: "", submitting: false,
  });

  async function loadAll() {
    setLoading(true); setErr(null);
    try {
      const [p, pr, m] = await Promise.all([
        listPersonas(),
        listFixProposals({ limit: 200 }),
        getPersonaConflictMatrix({ onlyConflicts, limit: 200 }),
      ]);
      setPersonas(p);
      setProposals(pr.filter((x) =>
        ["draft", "in_review", "changes_requested"].includes(x.review_state),
      ));
      setMatrix(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [onlyConflicts]);

  async function openProposal(p: OutcomeFixProposal) {
    setSelected(p); setSelLoading(true); setSelSims([]);
    try {
      const r = await getPersonaSimulations(p.id);
      setSelSims(r.simulations);
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSelLoading(false);
    }
  }

  function openSimDialog(personaKey: PersonaKey) {
    const existing = selSims.find((s) => s.persona_key === personaKey);
    setSimDialog({
      open: true, personaKey,
      utility: existing?.utility_score ?? 0.5,
      risk: existing?.risk_score ?? 0.5,
      comprehension: existing?.comprehension_score ?? 0.5,
      conversion: existing?.conversion_learning_score ?? 0.5,
      rationale: existing?.rationale ?? "",
      submitting: false,
    });
  }

  async function submitSim() {
    if (!selected || !simDialog.personaKey) return;
    if (simDialog.rationale.trim().length < 16) {
      toast({ title: "Begründung zu kurz", description: "Mindestens 16 Zeichen.", variant: "destructive" });
      return;
    }
    setSimDialog((d) => ({ ...d, submitting: true }));
    try {
      await simulateProposalPersona({
        proposalId: selected.id,
        personaKey: simDialog.personaKey,
        utilityScore: simDialog.utility,
        riskScore: simDialog.risk,
        comprehensionScore: simDialog.comprehension,
        conversionLearningScore: simDialog.conversion,
        rationale: simDialog.rationale.trim(),
      });
      toast({ title: "Simulation gespeichert", description: "HITL — keine Auto-Anwendung." });
      setSimDialog((d) => ({ ...d, open: false, submitting: false }));
      await openProposal(selected);
      await loadAll();
    } catch (e) {
      setSimDialog((d) => ({ ...d, submitting: false }));
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function clearSim(personaKey: PersonaKey) {
    if (!selected) return;
    const reason = window.prompt("Grund für das Entfernen (mind. 8 Zeichen):", "Korrektur");
    if (!reason || reason.trim().length < 8) return;
    try {
      await clearPersonaSimulation(selected.id, personaKey, reason.trim());
      toast({ title: "Simulation entfernt" });
      await openProposal(selected);
      await loadAll();
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  const matrixByProposal = useMemo(() => {
    const m = new Map<string, PersonaMatrixRow>();
    matrix.forEach((r) => m.set(r.proposal_id, r));
    return m;
  }, [matrix]);

  const kpi = useMemo(() => {
    const total = matrix.length;
    const conflicted = matrix.filter((m) => m.is_conflicted).length;
    const avgSpread =
      matrix.length === 0
        ? null
        : matrix.reduce((a, b) => a + (b.utility_spread ?? 0), 0) / matrix.length;
    return { total, conflicted, avgSpread };
  }, [matrix]);

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <Helmet>
        <title>Persona Simulation Layer · BerufAgentOS</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-text-secondary" />
          <h1 className="text-2xl font-semibold text-text-primary">
            Persona Simulation Layer
          </h1>
          <Badge variant="outline" className="ml-2">Cut 2.5 · HITL</Badge>
        </div>
        <p className="max-w-3xl text-sm text-text-secondary">
          Decision Intelligence vor menschlicher Freigabe. Fix-Proposals werden gegen
          reale Nutzerrollen simuliert (Nutzen, Risiko, Verständnis, Conversion-/Lernwirkung).
          <strong className="ml-1 text-text-primary">Kein Auto-Apply.</strong> Entscheidungen erfolgen
          ausschließlich in der{" "}
          <Link to="/admin/berufs-ki/fix-queue" className="underline">Fix-Queue</Link>
          {" · "}aggregierte Sicht im{" "}
          <Link to="/admin/berufs-ki/mission-control" className="underline">Mission Control</Link>.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-text-tertiary">Simulierte Proposals</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">{kpi.total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-text-tertiary">Konfliktfälle</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-status-error">{kpi.conflicted}</span>
            <span className="text-xs text-text-tertiary">Nutzen↑ / Risiko↑ gemischt</span>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-text-tertiary">Ø Nutzen-Spread</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">
            {kpi.avgSpread == null ? "—" : `${Math.round(kpi.avgSpread * 100)}%`}
          </div>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setOnlyConflicts((v) => !v)}>
          {onlyConflicts ? "Alle anzeigen" : "Nur Konflikte"}
        </Button>
        <Button variant="ghost" size="sm" onClick={loadAll} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aktualisieren"}
        </Button>
        <span className="text-xs text-text-tertiary">
          {personas.length} Personas registriert · {proposals.length} offene Proposals
        </span>
      </div>

      {err && (
        <Card className="border-status-error/30 bg-status-error-subtle">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-status-error">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>{err}</div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-tertiary">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Persona-Daten…
        </div>
      ) : proposals.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-text-tertiary">
          Keine offenen Fix-Proposals zur Simulation. Sobald Vorschläge in der Fix-Queue eingehen,
          erscheinen sie hier.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {proposals.map((p) => {
            const m = matrixByProposal.get(p.id);
            return (
              <Card key={p.id} className={selected?.id === p.id ? "border-primary" : ""}>
                <CardHeader className="space-y-2 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{p.title}</CardTitle>
                    {m?.is_conflicted && (
                      <Badge className="bg-status-error-subtle text-status-error border-status-error/30">
                        <ShieldAlert className="mr-1 h-3 w-3" /> Konflikt
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs text-text-tertiary">
                    <Badge variant="outline">{p.vertical_key}</Badge>
                    <Badge variant="outline">{p.proposal_type}</Badge>
                    <Badge variant="outline">{p.review_state}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-text-secondary line-clamp-2">{p.proposal_summary}</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-text-tertiary">Simuliert</div>
                      <div className="font-mono text-text-primary">{m?.personas_simulated ?? 0}/{personas.length}</div>
                    </div>
                    <div>
                      <div className="text-text-tertiary">Ø Score</div>
                      <div className="font-mono text-text-primary">
                        {m?.avg_composite == null ? "—" : Math.round((m.avg_composite as number) * 100) + "%"}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-tertiary">Spread</div>
                      <div className="font-mono text-text-primary">
                        {m?.utility_spread == null ? "—" : Math.round((m.utility_spread as number) * 100) + "%"}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openProposal(p)}>
                    <GitPullRequest className="mr-1 h-3 w-3" /> Personas öffnen
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail-Panel */}
      {selected && (
        <Card className="border-primary/40">
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{selected.title}</CardTitle>
              <div className="mt-1 text-xs text-text-tertiary">
                Persona-Bewertungen · HITL — keine Auto-Anwendung
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setSelected(null); setSelSims([]); }}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {selLoading ? (
              <div className="flex items-center gap-2 text-sm text-text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" /> Lade Simulationen…
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {personas.map((persona) => {
                  const sim = selSims.find((s) => s.persona_key === persona.persona_key);
                  return (
                    <Card key={persona.persona_key} className="bg-surface-muted">
                      <CardHeader className="space-y-1 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-sm">{persona.display_name}</CardTitle>
                          <Badge className={RISK_TONE[persona.default_risk_profile]}>
                            {persona.default_risk_profile}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-text-tertiary">
                          {persona.responsibility_scope}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {sim ? (
                          <>
                            <div className="space-y-2">
                              <ScoreBar label="Nutzen" value={sim.utility_score} />
                              <ScoreBar label="Risiko" value={sim.risk_score} />
                              <ScoreBar label="Verständnis" value={sim.comprehension_score} />
                              <ScoreBar label="Conversion / Lernwirkung" value={sim.conversion_learning_score} />
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-text-tertiary">Composite</span>
                              <span className="font-mono text-text-primary">
                                {Math.round(sim.composite_score * 100)}%
                              </span>
                            </div>
                            <div className="rounded border border-border-subtle bg-surface-base p-2 text-xs text-text-secondary">
                              {sim.rationale}
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => openSimDialog(persona.persona_key)}>
                                Bearbeiten
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => clearSim(persona.persona_key)}>
                                Entfernen
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-3">
                            <div className="text-xs text-text-tertiary">Noch nicht simuliert.</div>
                            <Button size="sm" onClick={() => openSimDialog(persona.persona_key)}>
                              Persona simulieren
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={simDialog.open}
        onOpenChange={(open) => setSimDialog((d) => ({ ...d, open }))}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Persona simulieren · {simDialog.personaKey ? personas.find(p => p.persona_key === simDialog.personaKey)?.display_name : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded border border-status-info/30 bg-status-info-subtle p-2 text-xs text-status-info">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              HITL-Bewertung. Speichert keine Anwendung, keine Mutation — nur Entscheidungsgrundlage.
            </div>

            {[
              { key: "utility", label: "Nutzen (0–1)" },
              { key: "risk", label: "Risiko (0–1)" },
              { key: "comprehension", label: "Verständnis (0–1)" },
              { key: "conversion", label: "Conversion / Lernwirkung (0–1)" },
            ].map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs text-text-secondary">{f.label}</label>
                <Input
                  type="number" min={0} max={1} step={0.05}
                  value={(simDialog as Record<string, unknown>)[f.key] as number}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(1, Number(e.target.value)));
                    setSimDialog((d) => ({ ...d, [f.key]: v }));
                  }}
                />
              </div>
            ))}

            <div className="space-y-1">
              <label className="text-xs text-text-secondary">
                Begründung (mind. 16 Zeichen)
              </label>
              <Textarea
                rows={4} value={simDialog.rationale}
                onChange={(e) => setSimDialog((d) => ({ ...d, rationale: e.target.value }))}
                placeholder="Warum schneidet diese Persona so ab? Welche konkreten Effekte werden erwartet?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSimDialog((d) => ({ ...d, open: false }))}>
              Abbrechen
            </Button>
            <Button onClick={submitSim} disabled={simDialog.submitting}>
              {simDialog.submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Simulation speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
