/**
 * VerwaltungsOS — Arbeitsmarkt-Lagebild v1 (UI)
 *
 * Macht die öffentliche Jobsuche-API der Bundesagentur für Arbeit (bund.dev)
 * als berufs-zentriertes Lagebild sichtbar.
 *
 * Anti-Drift:
 *  - Read-only Pass-Through (keine eigene Bewertung/Generation)
 *  - Quelle jedes Items wird sichtbar mitgeführt
 *  - Kein Persistenz-Layer
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, MapPin, Building2, TrendingUp, RefreshCw, ExternalLink, Search } from "lucide-react";

interface JobItem {
  source: "BA_JOBSUCHE";
  refnr: string;
  titel: string;
  beruf: string | null;
  arbeitgeber: string | null;
  plz: string | null;
  ort: string | null;
  region: string | null;
  eintrittsdatum: string | null;
  veroeffentlicht: string | null;
  externe_url: string | null;
  detail_url: string;
}

interface ArbeitsmarktResponse {
  query: { was?: string; wo?: string; umkreis?: number; size?: number; page?: number };
  fetched_at: string;
  source: string;
  jobs: JobItem[];
  aggregation: {
    total: number;
    page: number;
    size: number;
    top_arbeitgeber: { name: string; count: number }[];
    top_orte: { name: string; count: number }[];
    trend: { last_7_days: number; last_14_days: number; last_30_days: number };
  };
  errors: { message: string }[];
}

const PRESETS: { label: string; was: string }[] = [
  { label: "Verwaltungsfachangestellte", was: "Verwaltungsfachangestellte" },
  { label: "Verwaltungsfachwirt", was: "Verwaltungsfachwirt" },
  { label: "Sachbearbeiter Öffentlicher Dienst", was: "Sachbearbeiter öffentlicher Dienst" },
  { label: "Bauamt / Bauverwaltung", was: "Bauamt" },
  { label: "Sozialamt", was: "Sozialamt" },
  { label: "Standesamt", was: "Standesamt" },
  { label: "Ordnungsamt", was: "Ordnungsamt" },
  { label: "IT-Verwaltung / E-Government", was: "E-Government" },
];

export function VerwaltungArbeitsmarktSection() {
  const [was, setWas] = useState<string>(PRESETS[0].was);
  const [wo, setWo] = useState<string>("");
  const [umkreis, setUmkreis] = useState<number>(25);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<ArbeitsmarktResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    supabase.functions
      .invoke<ArbeitsmarktResponse>("verwaltung-arbeitsmarkt", {
        body: { was, wo: wo || undefined, umkreis: wo ? umkreis : 0, size: 25, page: 1 },
      })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setError(error.message);
        else setData(data ?? null);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [was, wo, umkreis, trigger]);

  const sortedJobs = useMemo(
    () => (data?.jobs ?? []).slice().sort((a, b) => (b.veroeffentlicht ?? "").localeCompare(a.veroeffentlicht ?? "")),
    [data]
  );

  return (
    <section className="border-t border-border bg-surface-0">
      <div className="container mx-auto px-4 py-14 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Briefcase className="w-5 h-5 text-primary" />
              <span className="text-xs uppercase tracking-wider text-text-3">
                VerwaltungsOS — Arbeitsmarkt-Lagebild
              </span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-text-1">
              Echtzeit-Berufsdaten aus dem öffentlichen Dienst
            </h2>
            <p className="text-text-2 mt-2 max-w-3xl">
              Live-Stellenangebote, Top-Arbeitgeber, Top-Standorte und Veröffentlichungstrends —
              direkt aus der offiziellen Jobsuche-API der Bundesagentur für Arbeit.
              Keine eigene Bewertung, kein KI-Halluzination — strukturierter Pass-Through.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTrigger((t) => t + 1)} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
        </div>

        {/* Preset-Berufe */}
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant={was === p.was ? "default" : "outline"}
              onClick={() => setWas(p.was)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Custom Search */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-6">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-text-3" />
            <Input
              className="pl-9"
              value={was}
              onChange={(e) => setWas(e.target.value)}
              placeholder="Beruf / Stichwort"
            />
          </div>
          <div className="md:col-span-4 relative">
            <MapPin className="w-4 h-4 absolute left-3 top-3 text-text-3" />
            <Input
              className="pl-9"
              value={wo}
              onChange={(e) => setWo(e.target.value)}
              placeholder="Ort oder PLZ (optional)"
            />
          </div>
          <div className="md:col-span-3">
            <select
              className="w-full h-10 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-1"
              value={umkreis}
              onChange={(e) => setUmkreis(Number(e.target.value))}
              disabled={!wo}
            >
              <option value={0}>Kein Umkreis</option>
              <option value={10}>+10 km</option>
              <option value={25}>+25 km</option>
              <option value={50}>+50 km</option>
              <option value={100}>+100 km</option>
              <option value={200}>+200 km</option>
            </select>
          </div>
        </div>

        {error && (
          <Card className="mb-4 border-status-error/50 bg-status-bg-subtle-error">
            <CardContent className="py-3 text-sm text-status-error">{error}</CardContent>
          </Card>
        )}

        {/* KPI / Aggregation */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KpiTile
            label="Treffer gesamt"
            value={loading ? null : (data?.aggregation.total ?? 0).toLocaleString("de-DE")}
            icon={<Briefcase className="w-4 h-4" />}
          />
          <KpiTile
            label="Neu (7 Tage)"
            value={loading ? null : String(data?.aggregation.trend.last_7_days ?? 0)}
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <KpiTile
            label="Neu (14 Tage)"
            value={loading ? null : String(data?.aggregation.trend.last_14_days ?? 0)}
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <KpiTile
            label="Neu (30 Tage)"
            value={loading ? null : String(data?.aggregation.trend.last_30_days ?? 0)}
            icon={<TrendingUp className="w-4 h-4" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top-Arbeitgeber */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> Top-Arbeitgeber
              </CardTitle>
              <CardDescription className="text-xs">in dieser Stichprobe</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              {!loading && (data?.aggregation.top_arbeitgeber ?? []).length === 0 && (
                <p className="text-xs text-text-3">Keine Daten.</p>
              )}
              {!loading && data?.aggregation.top_arbeitgeber.map((a) => (
                <div key={a.name} className="flex justify-between text-sm text-text-2">
                  <span className="truncate pr-2">{a.name}</span>
                  <Badge variant="secondary">{a.count}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Top-Orte */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" /> Top-Standorte
              </CardTitle>
              <CardDescription className="text-xs">in dieser Stichprobe</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              {!loading && (data?.aggregation.top_orte ?? []).length === 0 && (
                <p className="text-xs text-text-3">Keine Daten.</p>
              )}
              {!loading && data?.aggregation.top_orte.map((a) => (
                <div key={a.name} className="flex justify-between text-sm text-text-2">
                  <span className="truncate pr-2">{a.name}</span>
                  <Badge variant="secondary">{a.count}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quelle */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quelle</CardTitle>
              <CardDescription className="text-xs">Read-only Bridge</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-text-2">
              <p>{data?.source ?? "Bundesagentur für Arbeit — Jobsuche v4 (bund.dev)"}</p>
              <p className="text-text-3">
                Stand: {data?.fetched_at ? new Date(data.fetched_at).toLocaleString("de-DE") : "—"}
              </p>
              <a
                href="https://bund.dev/apis"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                bund.dev / Arbeitsagentur APIs <ExternalLink className="w-3 h-3" />
              </a>
            </CardContent>
          </Card>
        </div>

        {/* Job-Liste */}
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Aktuelle Stellenangebote</CardTitle>
            <CardDescription className="text-xs">
              Sortiert nach Veröffentlichungsdatum. Klick öffnet das offizielle Detail auf arbeitsagentur.de.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            )}
            {!loading && sortedJobs.length === 0 && (
              <p className="text-sm text-text-3">Keine Stellenangebote gefunden.</p>
            )}
            {!loading && sortedJobs.length > 0 && (
              <ul className="divide-y divide-border">
                {sortedJobs.map((j) => (
                  <li key={j.refnr} className="py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="min-w-0">
                      <a
                        href={j.externe_url || j.detail_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-text-1 hover:text-primary truncate block"
                      >
                        {j.titel}
                      </a>
                      <p className="text-xs text-text-3 truncate">
                        {[j.arbeitgeber, j.beruf].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(j.ort || j.region) && (
                        <Badge variant="outline" className="text-xs">
                          <MapPin className="w-3 h-3 mr-1" />{j.ort ?? j.region}
                        </Badge>
                      )}
                      {j.veroeffentlicht && (
                        <Badge variant="secondary" className="text-xs">
                          {new Date(j.veroeffentlicht).toLocaleDateString("de-DE")}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-text-3 mt-6">
          Quelle: Bundesagentur für Arbeit, Jobsuche API v4 (öffentlich, keyless via bund.dev).
          BerufOS aggregiert read-only — keine eigene Generierung, keine Persistenz.
        </p>
      </div>
    </section>
  );
}

function KpiTile({ label, value, icon }: { label: string; value: string | null; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-xs text-text-3 mb-1">{icon}{label}</div>
        {value === null
          ? <Skeleton className="h-7 w-20" />
          : <div className="text-2xl font-bold text-text-1">{value}</div>}
      </CardContent>
    </Card>
  );
}
