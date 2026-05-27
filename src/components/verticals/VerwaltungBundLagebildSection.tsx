/**
 * VerwaltungsOS — Bund-API Lagebild v1 (UI)
 *
 * Macht öffentliche, keyless Bund.dev-Schnittstellen (NINA + Pegel-Online)
 * als verwaltungstaugliches Echtzeit-Lagebild sichtbar.
 *
 * Anti-Drift:
 *  - Read-only Pass-Through (keine eigene Bewertung/Generation)
 *  - Quelle jedes Items wird sichtbar mitgeführt
 *  - Kein Persistenz-Layer, keine Shadow-States
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CloudRain, Waves, RefreshCw, Radio, ShieldAlert } from "lucide-react";

interface WarningItem {
  source: "MOWAS" | "DWD" | "LHP" | "POLICE" | "BIWAPP" | "UNKNOWN";
  id: string;
  headline: string;
  severity: string | null;
  urgency: string | null;
  effective: string | null;
  expires: string | null;
  sender: string | null;
  area: string | null;
}

interface PegelItem {
  station: string;
  water: string;
  longname: string;
  value: number | null;
  unit: string;
  timestamp: string | null;
  trend: number | null;
}

interface LagebildResponse {
  ars: string | null;
  region_name: string | null;
  fetched_at: string;
  warnings: WarningItem[];
  pegel: PegelItem[];
  errors: { source: string; message: string }[];
  meta: {
    sources: string[];
    cache: "hit" | "miss";
    nina_count: number;
    pegel_count: number;
  };
}

const REGION_PRESETS: { label: string; ars: string }[] = [
  { label: "Berlin", ars: "110000000000" },
  { label: "Hamburg", ars: "020000000000" },
  { label: "München (Stadt)", ars: "091620000000" },
  { label: "Köln", ars: "053150000000" },
  { label: "Frankfurt a. M.", ars: "064120000000" },
  { label: "Leipzig", ars: "147130000000" },
  { label: "Dresden", ars: "146120000000" },
  { label: "Stuttgart", ars: "081110000000" },
  { label: "Düsseldorf", ars: "051110000000" },
  { label: "Hannover", ars: "032410010000" },
];

const SOURCE_LABEL: Record<WarningItem["source"], string> = {
  MOWAS: "MoWaS (Bevölkerungsschutz)",
  DWD: "DWD Wetterwarnung",
  LHP: "Länder-Hochwasserportal",
  POLICE: "Polizei",
  BIWAPP: "BIWAPP",
  UNKNOWN: "Bund-Warnung",
};

const SOURCE_ICON: Record<WarningItem["source"], typeof AlertTriangle> = {
  MOWAS: ShieldAlert,
  DWD: CloudRain,
  LHP: Waves,
  POLICE: Radio,
  BIWAPP: AlertTriangle,
  UNKNOWN: AlertTriangle,
};

function severityTone(sev: string | null): "destructive" | "default" | "secondary" {
  const s = (sev || "").toLowerCase();
  if (s.includes("extreme") || s.includes("severe")) return "destructive";
  if (s.includes("moderate")) return "default";
  return "secondary";
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function VerwaltungBundLagebildSection() {
  const [ars, setArs] = useState<string>(REGION_PRESETS[0].ars);
  const [regionName, setRegionName] = useState<string>(REGION_PRESETS[0].label);
  const [includePegel, setIncludePegel] = useState<boolean>(true);
  const [data, setData] = useState<LagebildResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke<LagebildResponse>(
        "verwaltung-bund-lagebild",
        { body: { ars, region_name: regionName, include_pegel: includePegel } },
      );
      if (err) throw err;
      setData(res || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lagebild konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ars, includePegel]);

  const warningsBySource = useMemo(() => {
    const map = new Map<WarningItem["source"], WarningItem[]>();
    (data?.warnings || []).forEach((w) => {
      const list = map.get(w.source) || [];
      list.push(w);
      map.set(w.source, list);
    });
    return map;
  }, [data]);

  return (
    <section className="py-12 border-t border-border">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="gap-1">
              <Radio className="h-3 w-3" /> Bund.dev Live-Daten
            </Badge>
            <Badge variant="secondary">Read-only · keyless</Badge>
          </div>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
            Verwaltungs-Lagebild aus Bund-APIs
          </h2>
          <p className="text-muted-foreground max-w-3xl">
            NINA (Bevölkerungsschutz, DWD-Wetterwarnungen, Hochwasser, Polizei) und Pegel-Online der
            Wasserstraßen- und Schifffahrtsverwaltung — direkt für Fachbereiche wie Ordnungsamt,
            Bauamt, Umwelt und Krisenstab nutzbar.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6 items-center">
          {REGION_PRESETS.map((r) => (
            <Button
              key={r.ars}
              size="sm"
              variant={ars === r.ars ? "default" : "outline"}
              onClick={() => {
                setArs(r.ars);
                setRegionName(r.label);
              }}
            >
              {r.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={includePegel ? "default" : "outline"}
            onClick={() => setIncludePegel((v) => !v)}
          >
            <Waves className="h-4 w-4 mr-1" /> Pegel {includePegel ? "ein" : "aus"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Neu laden
          </Button>
        </div>

        {error && (
          <Card className="mb-4 border-destructive/50">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" /> Aktive Warnungen
              </CardTitle>
              <CardDescription>
                {regionName} · ARS {ars} ·{" "}
                {loading ? "lädt …" : `${data?.meta.nina_count ?? 0} Meldungen`}
                {data?.meta.cache === "hit" && " · gecached"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && <Skeleton className="h-24 w-full" />}
              {!loading && (data?.warnings.length || 0) === 0 && (
                <p className="text-sm text-muted-foreground">
                  Aktuell keine aktiven NINA-Warnungen für diese Region.
                </p>
              )}
              {[...warningsBySource.entries()].map(([source, list]) => {
                const Icon = SOURCE_ICON[source];
                return (
                  <div key={source} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {SOURCE_LABEL[source]} · {list.length}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {list.slice(0, 5).map((w) => (
                        <li key={w.id} className="text-sm">
                          <div className="flex items-start gap-2">
                            <Badge variant={severityTone(w.severity)} className="shrink-0">
                              {w.severity || "Info"}
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{w.headline}</div>
                              <div className="text-xs text-muted-foreground">
                                {w.area || w.sender || "—"} · ab {fmtTime(w.effective)}
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Waves className="h-5 w-5" /> Pegelstände (Rhein / Elbe / Donau)
              </CardTitle>
              <CardDescription>
                Pegel-Online (WSV) ·{" "}
                {loading ? "lädt …" : `${data?.meta.pegel_count ?? 0} Stationen`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!includePegel && (
                <p className="text-sm text-muted-foreground">Pegel-Layer ist deaktiviert.</p>
              )}
              {includePegel && loading && <Skeleton className="h-32 w-full" />}
              {includePegel && !loading && (data?.pegel.length || 0) === 0 && (
                <p className="text-sm text-muted-foreground">Keine Pegelstände verfügbar.</p>
              )}
              {includePegel && !loading && (data?.pegel.length || 0) > 0 && (
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-1 px-2">Pegel</th>
                        <th className="text-left py-1 px-2">Gewässer</th>
                        <th className="text-right py-1 px-2">W</th>
                        <th className="text-right py-1 px-2">Trend</th>
                        <th className="text-left py-1 px-2">Stand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.pegel.map((p) => (
                        <tr key={`${p.station}-${p.water}`} className="border-b border-border/40">
                          <td className="py-1 px-2 font-medium">{p.station}</td>
                          <td className="py-1 px-2 text-muted-foreground">{p.water}</td>
                          <td className="py-1 px-2 text-right tabular-nums">
                            {p.value !== null ? `${p.value} ${p.unit}` : "—"}
                          </td>
                          <td className="py-1 px-2 text-right tabular-nums">
                            {p.trend === 1 ? "↑" : p.trend === -1 ? "↓" : p.trend === 0 ? "→" : "—"}
                          </td>
                          <td className="py-1 px-2 text-xs text-muted-foreground">
                            {fmtTime(p.timestamp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Quellen: NINA-API (warnung.bund.de), Pegel-Online (pegelonline.wsv.de). VerwaltungsOS
          aggregiert read-only, ohne eigene Bewertung. Aktualisierung serverseitig alle 60 Sekunden.
        </p>
      </div>
    </section>
  );
}
