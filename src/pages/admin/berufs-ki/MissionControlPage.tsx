/**
 * BerufAgentOS v2 — Cut 2.6 Mission Control (READ-ONLY, HITL strict)
 *
 * Aggregiert 2.1 Business Intents · 2.3 Outcome Intelligence · 2.4 Fix-Queue
 * · 2.5 Persona-Simulation + Cross-Proposal-Konfliktauflösung.
 *
 * STRIKT KEIN AUTO-APPLY. KEINE MUTATION. KEIN SELF-HEAL.
 * Reine Entscheidungsvorbereitung für menschliche Reviewer.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import {
  AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, GitMerge,
  Loader2, ShieldAlert, Target, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getMissionControlOverview, getCrossProposalConflicts, getExecutiveDecisionQueue,
  type MissionControlOverview, type CrossProposalConflict,
  type ExecutiveDecisionRow, type MissionControlRecommendation,
} from "@/lib/berufs-ki/outcome";

const RECO_TONE: Record<MissionControlRecommendation, string> = {
  go: "bg-status-success-subtle text-status-success border-status-success/30",
  review: "bg-status-warn-subtle text-status-warn border-status-warn/30",
  block: "bg-status-error-subtle text-status-error border-status-error/30",
};

const RECO_LABEL: Record<MissionControlRecommendation, string> = {
  go: "Go",
  review: "Review",
  block: "Block",
};

function KpiCard({
  title, value, sub, tone, icon: Icon,
}: {
  title: string; value: string | number; sub?: string;
  tone?: "default" | "warn" | "error" | "success";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const toneClass =
    tone === "error" ? "border-status-error/40 bg-status-error-subtle"
    : tone === "warn" ? "border-status-warn/40 bg-status-warn-subtle"
    : tone === "success" ? "border-status-success/40 bg-status-success-subtle"
    : "border-border bg-surface-base";
  return (
    <Card className={`p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-text-secondary">{title}</div>
        {Icon && <Icon className="h-4 w-4 text-text-tertiary" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">{value}</div>
      {sub && <div className="mt-1 text-xs text-text-tertiary">{sub}</div>}
    </Card>
  );
}

export default function MissionControlPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [overview, setOverview] = useState<MissionControlOverview | null>(null);
  const [decisions, setDecisions] = useState<ExecutiveDecisionRow[]>([]);
  const [conflicts, setConflicts] = useState<CrossProposalConflict[]>([]);
  const [recoFilter, setRecoFilter] = useState<MissionControlRecommendation | "all">("all");
  const [onlyHighTension, setOnlyHighTension] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [ov, dq, cf] = await Promise.all([
        getMissionControlOverview(),
        getExecutiveDecisionQueue({
          recommendation: recoFilter === "all" ? null : recoFilter,
          limit: 200,
        }),
        getCrossProposalConflicts({ onlyHighTension, limit: 200 }),
      ]);
      setOverview(ov);
      setDecisions(dq);
      setConflicts(cf);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [recoFilter, onlyHighTension]);

  const decisionCount = useMemo(
    () => ({
      go: decisions.filter((d) => d.recommendation === "go").length,
      review: decisions.filter((d) => d.recommendation === "review").length,
      block: decisions.filter((d) => d.recommendation === "block").length,
    }),
    [decisions],
  );

  return (
    <div className="min-h-screen bg-surface-canvas">
      <Helmet>
        <title>Mission Control · BerufAgentOS</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 lg:px-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-text-tertiary">
              <Target className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wider">BerufAgentOS v2 · Cut 2.6</span>
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-text-primary">
              Mission Control
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              Kontrollzentrum für Business Intents, Outcome Intelligence, Fix-Queue und
              Persona-Simulation. Read-only — jede Anwendung läuft über die Fix-Queue.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/berufs-ki/business-intents">Intents</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/berufs-ki/outcome-intelligence">Intelligence</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/berufs-ki/fix-queue">Fix-Queue</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/berufs-ki/persona-sim">Persona-Sim</Link>
            </Button>
          </div>
        </header>

        <div className="rounded-md border border-status-warn/30 bg-status-warn-subtle px-4 py-2 text-xs text-status-warn">
          <ShieldAlert className="mr-1 inline h-3 w-3" />
          HITL-only — Mission Control beobachtet, korreliert und empfiehlt.
          Anwendungen erfolgen ausschließlich manuell in der Fix-Queue.
        </div>

        {/* Loading */}
        {loading && (
          <Card className="p-12">
            <div className="flex flex-col items-center gap-2 text-text-secondary">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Lade Mission Control…</span>
            </div>
          </Card>
        )}

        {/* Error */}
        {err && !loading && (
          <Card className="border-status-error/40 bg-status-error-subtle p-6">
            <div className="flex items-start gap-3">
              <AlertOctagon className="mt-0.5 h-5 w-5 text-status-error" />
              <div className="flex-1">
                <div className="font-medium text-status-error">Mission Control konnte nicht geladen werden</div>
                <p className="mt-1 text-sm text-text-secondary">{err}</p>
                <Button onClick={load} size="sm" variant="outline" className="mt-3">
                  Erneut versuchen
                </Button>
              </div>
            </div>
          </Card>
        )}

        {!loading && !err && overview && (
          <>
            {/* KPI Strip */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiCard
                title="Business Intents"
                value={overview.business_intents.active}
                sub={`${overview.business_intents.total} gesamt`}
              />
              <KpiCard
                title="Offene Findings"
                value={overview.findings.open}
                sub={`${overview.findings.critical_open} kritisch`}
                tone={overview.findings.critical_open > 0 ? "error" : "default"}
                icon={AlertTriangle}
              />
              <KpiCard
                title="Offene Proposals"
                value={overview.fix_proposals.open}
                sub={
                  overview.fix_proposals.avg_priority != null
                    ? `Ø Priorität ${(overview.fix_proposals.avg_priority * 100).toFixed(0)}%`
                    : "—"
                }
              />
              <KpiCard
                title="Persona-Sims"
                value={overview.personas.simulated_proposals}
                sub={`${overview.personas.conflicts} Konflikte`}
                tone={overview.personas.conflicts > 0 ? "warn" : "default"}
                icon={Users}
              />
              <KpiCard
                title="Cross-Proposal Konflikte"
                value={overview.cross_proposal.conflict_pairs}
                sub="Paare"
                tone={overview.cross_proposal.conflict_pairs > 0 ? "warn" : "default"}
                icon={GitMerge}
              />
              <KpiCard
                title="Decision Queue"
                value={`${overview.decision_queue.go}·${overview.decision_queue.review}·${overview.decision_queue.block}`}
                sub="Go · Review · Block"
              />
            </section>

            {/* Risk Radar — quick split */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Risk Radar</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-status-success/30 bg-status-success-subtle p-4">
                  <div className="text-xs uppercase tracking-wider text-status-success">Go</div>
                  <div className="mt-1 text-3xl font-semibold text-text-primary">{overview.decision_queue.go}</div>
                  <p className="mt-1 text-xs text-text-secondary">
                    Hohe Priorität · geringes Risiko · hohe Confidence · kein Konflikt.
                  </p>
                </div>
                <div className="rounded-md border border-status-warn/30 bg-status-warn-subtle p-4">
                  <div className="text-xs uppercase tracking-wider text-status-warn">Review</div>
                  <div className="mt-1 text-3xl font-semibold text-text-primary">{overview.decision_queue.review}</div>
                  <p className="mt-1 text-xs text-text-secondary">
                    Manuelle Abwägung erforderlich — uneindeutige Signal-Kombination.
                  </p>
                </div>
                <div className="rounded-md border border-status-error/30 bg-status-error-subtle p-4">
                  <div className="text-xs uppercase tracking-wider text-status-error">Block</div>
                  <div className="mt-1 text-3xl font-semibold text-text-primary">{overview.decision_queue.block}</div>
                  <p className="mt-1 text-xs text-text-secondary">
                    Hohes Risiko, multiple Konflikte oder Persona-Tension — nicht freigeben.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Tabs: Decision Queue · Conflict Matrix */}
            <Tabs defaultValue="queue">
              <TabsList>
                <TabsTrigger value="queue">
                  Decision Queue ({decisions.length})
                </TabsTrigger>
                <TabsTrigger value="conflicts">
                  Conflict Matrix ({conflicts.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="queue" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={recoFilter} onValueChange={(v) => setRecoFilter(v as typeof recoFilter)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Empfehlung" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Empfehlungen</SelectItem>
                      <SelectItem value="block">Nur Block</SelectItem>
                      <SelectItem value="review">Nur Review</SelectItem>
                      <SelectItem value="go">Nur Go</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-text-tertiary">
                    {decisionCount.go} go · {decisionCount.review} review · {decisionCount.block} block
                  </span>
                </div>

                {decisions.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-text-secondary">
                    <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-status-success" />
                    Keine offenen Proposals in dieser Filterung.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {decisions.map((d) => (
                      <Card key={d.id} className="p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge className={RECO_TONE[d.recommendation]} variant="outline">
                                {RECO_LABEL[d.recommendation]}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{d.vertical_key}</Badge>
                              <Badge variant="outline" className="text-xs">{d.severity}</Badge>
                              <Badge variant="outline" className="text-xs">{d.review_state}</Badge>
                              {d.conflict_count > 0 && (
                                <Badge className="bg-status-warn-subtle text-status-warn border-status-warn/30" variant="outline">
                                  {d.conflict_count} Konflikt{d.conflict_count > 1 ? "e" : ""}
                                </Badge>
                              )}
                              {d.persona_conflict && (
                                <Badge className="bg-status-error-subtle text-status-error border-status-error/30" variant="outline">
                                  Persona-Tension
                                </Badge>
                              )}
                            </div>
                            <div className="truncate font-medium text-text-primary">{d.title}</div>
                            <div className="text-xs text-text-tertiary font-mono">{d.proposal_key}</div>
                            <div className="grid gap-2 pt-1 text-xs text-text-secondary sm:grid-cols-4">
                              <span>Priorität: <span className="font-mono text-text-primary">{(d.priority_score * 100).toFixed(0)}%</span></span>
                              <span>Risiko: <span className="font-mono text-text-primary">{(d.risk_score * 100).toFixed(0)}%</span></span>
                              <span>Impact: <span className="font-mono text-text-primary">{(d.business_impact_score * 100).toFixed(0)}%</span></span>
                              <span>Confidence: <span className="font-mono text-text-primary">{(d.confidence_score * 100).toFixed(0)}%</span></span>
                            </div>
                          </div>
                          <Button asChild size="sm" variant="outline">
                            <Link to="/admin/berufs-ki/fix-queue">
                              In Fix-Queue <ArrowRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="conflicts" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={onlyHighTension ? "default" : "outline"}
                    onClick={() => setOnlyHighTension((v) => !v)}
                  >
                    Nur High-Tension
                  </Button>
                  <span className="text-xs text-text-tertiary">
                    Konflikt-Paare zwischen offenen Proposals (gleicher Vertical + überlappender Scope/Intent).
                  </span>
                </div>

                {conflicts.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-text-secondary">
                    <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-status-success" />
                    Keine Konflikte erkannt.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {conflicts.map((c) => (
                      <Card key={`${c.proposal_a_id}|${c.proposal_b_id}`} className="p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-xs">{c.vertical_key}</Badge>
                          <Badge
                            className={
                              c.conflict_type === "business_intent_overlap"
                                ? "bg-status-error-subtle text-status-error border-status-error/30"
                                : c.conflict_type === "scope_overlap"
                                ? "bg-status-warn-subtle text-status-warn border-status-warn/30"
                                : ""
                            }
                            variant="outline"
                          >
                            {c.conflict_type}
                          </Badge>
                          {c.is_high_tension && (
                            <Badge className="bg-status-error-subtle text-status-error border-status-error/30" variant="outline">
                              High Tension
                            </Badge>
                          )}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div className="rounded border border-border bg-surface-muted p-2">
                            <div className="truncate text-sm font-medium text-text-primary">{c.proposal_a_title}</div>
                            <div className="font-mono text-xs text-text-tertiary">{c.proposal_a_key}</div>
                          </div>
                          <div className="rounded border border-border bg-surface-muted p-2">
                            <div className="truncate text-sm font-medium text-text-primary">{c.proposal_b_title}</div>
                            <div className="font-mono text-xs text-text-tertiary">{c.proposal_b_key}</div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Timeline footer */}
            <div className="text-xs text-text-tertiary">
              Snapshot generiert {new Date(overview.generated_at).toLocaleString("de-DE")}.
              Diese Seite verändert keine Daten — Entscheidungen erfolgen in der Fix-Queue.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
