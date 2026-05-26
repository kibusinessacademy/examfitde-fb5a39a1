import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, GitBranch, Workflow, ShieldAlert, Target } from "lucide-react";
import {
  useNextBestSkillActions,
  useGraphWorkflowRecommendations,
  useManagerRiskExplanations,
  useTutorGraphContext,
  useExamFitGraphBridge,
} from "@/hooks/useGraphActivation";
import { describeReason, type ActivationReason } from "@/lib/berufs-ki/graphActivation";

function ReasonBanner({ reason }: { reason: ActivationReason }) {
  if (reason === "OK") return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-status-bg-subtle px-3 py-2 text-xs text-text-secondary">
      {describeReason(reason)}
    </div>
  );
}

function CardShell({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 shadow-elev-1">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-surface-2 p-2 text-text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

// 1) Learner — Next-Best-Skill-Actions ----------------------------------------
export function NextBestSkillActionsCard() {
  const { data, isLoading } = useNextBestSkillActions(5);
  return (
    <CardShell
      icon={Brain}
      title="Nächste Skill-Aktionen"
      subtitle="Deterministisch aus dem BerufOS Intelligence Graph"
    >
      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && data && (
        <>
          {data.items.length > 0 ? (
            <ul className="space-y-2">
              {data.items.map((a) => (
                <li key={a.action_node_id} className="rounded-md border border-border bg-surface-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary">{a.action_title}</p>
                      <p className="text-xs text-text-secondary">
                        Schwäche in <span className="text-text-primary">{a.competency_title}</span> · über{" "}
                        <span className="font-mono">{a.via_edge}</span>
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {a.action_type}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <ReasonBanner reason={data.reason} />
        </>
      )}
    </CardShell>
  );
}

// 2) Tutor — Graph Context ----------------------------------------------------
export function TutorGraphContextCard({
  competencyId,
  lessonId,
}: {
  competencyId?: string;
  lessonId?: string;
}) {
  const { data, isLoading } = useTutorGraphContext({ competencyId, lessonId });
  return (
    <CardShell
      icon={GitBranch}
      title="Tutor-Kontext (Graph-Evidenz)"
      subtitle="Keine Antwort ohne nachvollziehbare Evidenz"
    >
      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && data && (
        <>
          {data.chain.length > 0 ? (
            <ul className="space-y-1.5">
              {data.chain.slice(0, 8).map((c) => (
                <li
                  key={c.edge_id}
                  className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2 text-xs"
                >
                  <span className="truncate text-text-primary">{c.neighbor_title}</span>
                  <span className="ml-2 shrink-0 font-mono text-text-secondary">
                    {c.edge_type} · {(c.confidence * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-[11px] text-text-tertiary">
            {data.evidence.length} Evidenz-Quellen verknüpft
          </p>
          <ReasonBanner reason={data.reason} />
        </>
      )}
    </CardShell>
  );
}

// 3) Workflow Recommendations -------------------------------------------------
export function GraphWorkflowRecommendationsCard() {
  const { data, isLoading } = useGraphWorkflowRecommendations(5);
  return (
    <CardShell
      icon={Workflow}
      title="Workflow-Empfehlungen"
      subtitle="Aus Skill-Lücken über den Graph abgeleitet"
    >
      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && data && (
        <>
          {data.items.length > 0 ? (
            <ul className="space-y-2">
              {data.items.map((w) => (
                <li key={w.workflow_node_id} className="rounded-md border border-border bg-surface-1 p-3">
                  <p className="text-sm font-medium text-text-primary">{w.workflow_title}</p>
                  {w.workflow_description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{w.workflow_description}</p>
                  )}
                  <p className="mt-1 text-[10px] font-mono text-text-tertiary">
                    via {w.via_edge} · Konfidenz {(w.edge_confidence * 100).toFixed(0)}%
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          <ReasonBanner reason={data.reason} />
        </>
      )}
    </CardShell>
  );
}

// 4) Manager — Risk Explanations ---------------------------------------------
export function ManagerRiskExplanationsCard() {
  const { data, isLoading } = useManagerRiskExplanations(30);
  return (
    <CardShell
      icon={ShieldAlert}
      title="Risiko-Erklärungen (Team)"
      subtitle="Begründet — nicht nur angezeigt"
    >
      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && data && (
        <>
          {data.items.length > 0 ? (
            <ul className="space-y-2">
              {data.items.map((r) => (
                <li key={r.competency_id} className="rounded-md border border-border bg-surface-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {r.competency_title ?? r.competency_id}
                    </p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {r.learners_affected} Lerner · ⌀ {(r.avg_mastery * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  {r.suggested_actions.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {r.suggested_actions.slice(0, 3).map((a) => (
                        <li key={a.action_id} className="text-xs text-text-secondary">
                          → <span className="text-text-primary">{a.title}</span>{" "}
                          <span className="font-mono text-text-tertiary">({a.edge_type})</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-text-tertiary">Keine Graph-Maßnahmen verknüpft.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <ReasonBanner reason={data.reason} />
        </>
      )}
    </CardShell>
  );
}

// 5) ExamFit Bridge -----------------------------------------------------------
export function ExamFitGraphBridgeCard({ certificationId }: { certificationId: string }) {
  const { data, isLoading } = useExamFitGraphBridge(certificationId);
  return (
    <CardShell
      icon={Target}
      title="ExamFit-Brücke"
      subtitle="Graph-priorisierte Prüfungs-Schwerpunkte"
    >
      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && data && (
        <>
          {data.items.length > 0 ? (
            <ul className="space-y-2">
              {data.items.slice(0, 8).map((it) => (
                <li key={it.comp_node_id} className="rounded-md border border-border bg-surface-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-text-primary">{it.title}</p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      Lücke {(it.gap * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  {it.suggested_blueprints.length > 0 && (
                    <p className="mt-1 text-[11px] text-text-tertiary">
                      {it.suggested_blueprints.length} Blueprint(s) priorisiert
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <ReasonBanner reason={data.reason} />
        </>
      )}
    </CardShell>
  );
}
