/**
 * VerwaltungsOS — Fachbereichs-Intelligenz Sektion
 *
 * Read-only Sichtbarmachung der strukturierten Fachbereichs-DNA (40 Ämter, KGSt-Cluster).
 * Erscheint nur auf /branchen/verwaltung. Keine generative AI, kein Shadow-State.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listVerwaltungDepartments,
  getVerwaltungDepartmentDna,
  getVerwaltungLiveJobsForQuery,
  type VerwaltungDepartmentSummary,
  type VerwaltungDepartmentDna,
  type VRealityJobsSummary,
} from "@/lib/berufs-ki/occupational-intelligence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, MessageSquare, AlertTriangle, Workflow, FileText, Target, Users2, ShieldAlert, Play, Briefcase, TrendingUp, ExternalLink } from "lucide-react";



const CLUSTER_ORDER = [
  "Service",
  "Soziales/Jugend",
  "Soziales/Bürger",
  "Schule/Kultur",
  "Bauen/Umwelt",
  "Wirtschaft",
  "Sicherheit/Ordnung",
  "Steuerung/Service",
];

function clusterRank(c: string): number {
  const i = CLUSTER_ORDER.indexOf(c);
  return i === -1 ? 999 : i;
}

interface SectionProps {
  /** Liefert die ersten 4 Spalten als Übersicht (Liste mit klickbaren Fachbereichen) */
  defaultDepartmentKey?: string;
}

export function VerwaltungDepartmentsSection({ defaultDepartmentKey = "buergeramt" }: SectionProps) {
  const [departments, setDepartments] = useState<VerwaltungDepartmentSummary[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>(defaultDepartmentKey);
  const [dna, setDna] = useState<VerwaltungDepartmentDna | null>(null);
  const [loadingDna, setLoadingDna] = useState(false);

  useEffect(() => {
    let alive = true;
    listVerwaltungDepartments().then((d) => {
      if (alive) setDepartments(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoadingDna(true);
    getVerwaltungDepartmentDna(selectedKey).then((d) => {
      if (!alive) return;
      setDna(d);
      setLoadingDna(false);
    });
    return () => {
      alive = false;
    };
  }, [selectedKey]);

  const grouped = useMemo(() => {
    if (!departments) return [] as Array<{ cluster: string; items: VerwaltungDepartmentSummary[] }>;
    const map = new Map<string, VerwaltungDepartmentSummary[]>();
    for (const d of departments) {
      const arr = map.get(d.category) ?? [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return Array.from(map.entries())
      .map(([cluster, items]) => ({
        cluster,
        items: items.sort((a, b) => a.department_name.localeCompare(b.department_name, "de")),
      }))
      .sort((a, b) => clusterRank(a.cluster) - clusterRank(b.cluster));
  }, [departments]);

  return (
    <section className="border-t border-border bg-surface-1">
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <div className="mb-8">
          <Badge variant="outline" className="mb-3">VerwaltungsOS · Fachbereichs-Intelligenz</Badge>
          <h2 className="text-2xl md:text-3xl font-bold text-text-1 mb-2">
            {departments?.length ?? "40"} Fachbereiche — strukturiert verstanden
          </h2>
          <p className="text-text-2 max-w-3xl">
            VerwaltungsOS basiert nicht auf generischem KI-Chat, sondern auf strukturierter
            Fachbereichs-Intelligenz: Prozesse, KPIs, Eskalationspfade, Bürgerkommunikation und
            Oral-Training-Szenarien — pro Amt, KGSt-konform geclustert.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Cluster + Fachbereichs-Liste */}
          <aside className="space-y-5">
            {departments === null ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              grouped.map((group) => (
                <div key={group.cluster}>
                  <h3 className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">
                    {group.cluster}
                  </h3>
                  <ul className="space-y-1">
                    {group.items.map((d) => {
                      const active = d.department_key === selectedKey;
                      return (
                        <li key={d.department_key}>
                          <button
                            type="button"
                            onClick={() => setSelectedKey(d.department_key)}
                            className={
                              "w-full text-left px-3 py-2 rounded-md text-sm transition-colors " +
                              (active
                                ? "bg-primary text-primary-foreground"
                                : "text-text-2 hover:bg-surface-2 hover:text-text-1")
                            }
                          >
                            {d.department_name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </aside>

          {/* Detail-Panel */}
          <div className="min-h-[420px]">
            {loadingDna || !dna ? (
              <Skeleton className="h-[420px] w-full" />
            ) : (
              <DepartmentDetail dna={dna} />
            )}
          </div>
        </div>

        <p className="text-xs text-text-3 mt-8">
          Quelle: VerwaltungsOS Fachbereichs-DNA v1 — read-only Bridge aus strukturierter
          Verwaltungsrealität. Keine generierten Inhalte, keine Halluzination.
        </p>
      </div>
    </section>
  );
}

function DepartmentDetail({ dna }: { dna: VerwaltungDepartmentDna }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <Badge variant="outline" className="mb-2">{dna.category}</Badge>
          <h3 className="text-xl font-semibold text-text-1">{dna.department_name}</h3>
        </div>
        <div className="text-right text-xs text-text-3 shrink-0">
          <div>{dna.use_cases?.length ?? 0} Use-Cases</div>
          <div>{dna.oral_training_cases?.length ?? 0} Oral-Szenarien</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Block icon={<Workflow className="h-4 w-4" />} title="Prozesse" items={dna.processes} />
        <Block icon={<Target className="h-4 w-4" />} title="KPIs" items={dna.kpis} />
        <Block icon={<AlertTriangle className="h-4 w-4" />} title="Risiken" items={dna.risks} />
        <Block icon={<FileText className="h-4 w-4" />} title="Dokumente" items={dna.documents} />
        <Block icon={<MessageSquare className="h-4 w-4" />} title="Kommunikationsmuster" items={dna.communication_patterns} />
        <Block icon={<ShieldAlert className="h-4 w-4" />} title="Eskalationspfade" items={dna.escalation_paths} />
        <Block icon={<Building2 className="h-4 w-4" />} title="Entscheidungs-Modelle" items={dna.decision_models} />
        <Block icon={<Users2 className="h-4 w-4" />} title="Rollen" items={dna.roles} />
      </div>

      {/* Use Cases */}
      {dna.use_cases?.length > 0 && (
        <div className="mt-6 pt-5 border-t border-border">
          <h4 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Typische Vorgänge</h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {dna.use_cases.slice(0, 10).map((u) => (
              <li
                key={u.key}
                className="text-sm rounded-md border border-border bg-surface-1 px-3 py-2 text-text-2"
              >
                {u.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Oral-Training Bridge */}
      {dna.oral_training_cases?.length > 0 && (
        <div className="mt-6 pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-text-2 uppercase tracking-wide">
              Bürgerdialog & Krisengespräch — Oral-Trainer
            </h4>
            <span className="text-xs text-text-3">trainierbar</span>
          </div>
          <ul className="space-y-2">
            {dna.oral_training_cases.slice(0, 5).map((o) => (
              <li key={o.key} className="rounded-md border border-border bg-surface-1 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium text-text-1">{o.scenario_title}</div>
                  {o.conflict_level && (
                    <Badge
                      variant="outline"
                      className={
                        o.conflict_level === "high"
                          ? "border-destructive/40 text-destructive"
                          : o.conflict_level === "medium"
                          ? "border-warning/40 text-warning"
                          : "border-border text-text-3"
                      }
                    >
                      Konflikt: {o.conflict_level}
                    </Badge>
                  )}
                </div>
                {o.role_counterpart && (
                  <div className="text-xs text-text-3 mt-1">Gegenüber: {o.role_counterpart}</div>
                )}
                {o.communication_goal && (
                  <div className="text-xs text-text-2 mt-1">Ziel: {o.communication_goal}</div>
                )}
                {o.training_focus && (
                  <div className="text-xs text-text-3 mt-1 italic">{o.training_focus}</div>
                )}
                <div className="mt-2">
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to={`/branchen/verwaltung/oral/${dna.department_key}/${o.key}`}>
                      <Play className="h-3 w-3 mr-1" /> Simulation starten
                    </Link>
                  </Button>
                </div>
              </li>
            ))}

          </ul>
        </div>
      )}

      {/* Reality-Bridge v1: Live Arbeitsmarkt aus BA-Jobsuche */}
      <DepartmentLiveMarketCard
        departmentKey={dna.department_key}
        departmentName={dna.department_name}
      />
    </div>
  );
}

function DepartmentLiveMarketCard({
  departmentKey,
  departmentName,
}: {
  departmentKey: string;
  departmentName: string;
}) {
  const [jobs, setJobs] = useState<VRealityJobsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Kanonische Marktquery: identisch zu fn_verwaltung_market_query in der DB.
  const marketQuery = useMemo(
    () => departmentName.split("/")[0].split("(")[0].trim(),
    [departmentName],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setJobs(null);
    getVerwaltungLiveJobsForQuery(marketQuery)
      .then((res) => {
        if (!alive) return;
        if (!res) setError("Keine Live-Marktdaten verfügbar");
        else setJobs(res);
      })
      .catch(() => alive && setError("Verbindung zur Bundesagentur fehlgeschlagen"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [departmentKey, marketQuery]);

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-text-2 uppercase tracking-wide flex items-center gap-2">
          <Briefcase className="h-4 w-4" /> Arbeitsmarkt-Realität
        </h4>
        <span className="text-xs text-text-3">Quelle: BA Jobsuche · live</span>
      </div>
      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : error ? (
        <div className="text-sm text-text-3 italic">{error}</div>
      ) : jobs ? (
        <div className="rounded-md border border-border bg-surface-1 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Kpi label="Offene Stellen" value={jobs.total.toLocaleString("de-DE")} />
            <Kpi label="Neu 7 Tage" value={jobs.trend_7d.toString()} />
            <Kpi label="Neu 14 Tage" value={jobs.trend_14d.toString()} />
            <Kpi label="Neu 30 Tage" value={jobs.trend_30d.toString()} />
          </div>
          {jobs.top_arbeitgeber.length > 0 && (
            <div className="text-xs text-text-2">
              <span className="text-text-3">Top-Arbeitgeber:</span>{" "}
              {jobs.top_arbeitgeber.slice(0, 3).map((a) => `${a.name} (${a.count})`).join(" · ")}
            </div>
          )}
          {jobs.top_orte.length > 0 && (
            <div className="text-xs text-text-2 mt-1">
              <span className="text-text-3">Top-Standorte:</span>{" "}
              {jobs.top_orte.slice(0, 3).map((o) => `${o.name} (${o.count})`).join(" · ")}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-text-3">
              Suche: <code className="text-text-2">{jobs.market_query}</code>
            </span>
            <a
              href={`https://www.arbeitsagentur.de/jobsuche/suche?was=${encodeURIComponent(jobs.market_query)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              Alle Stellen <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-2">
      <div className="text-[10px] uppercase tracking-wide text-text-3">{label}</div>
      <div className="text-lg font-semibold text-text-1 leading-tight flex items-center gap-1">
        {value}
        <TrendingUp className="h-3 w-3 text-text-3" />
      </div>
    </div>
  );
}


function Block({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: Array<{ key: string; label: string }> | undefined;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-text-2 mb-2 uppercase tracking-wide flex items-center gap-1.5">
        <span className="text-text-3">{icon}</span>
        {title}
      </h4>
      <ul className="space-y-1">
        {items.slice(0, 5).map((it) => (
          <li key={it.key} className="text-sm text-text-2">
            <span className="text-text-3 mr-1.5">·</span>
            {it.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
