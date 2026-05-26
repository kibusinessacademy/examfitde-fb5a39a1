/**
 * /demo/hr — Cut 6.1 Phase 2
 * HR / Ausbildungsleiter Activation Demo (Hybrid: curated DB + AI personalize)
 *
 * Flow:
 *  1. Painpoint-Auswahl (6 vorgegebene Optionen) + optional Rolle/Größe
 *  2. SSE-Stream an hr-demo-personalize → erst Meta (Match-Karte), dann AI-Text
 *  3. CTA-Pfade (Pakete-Detail / Vertrieb-Kontakt)
 *
 * Tracking via emitFunnelEvent (lead_magnet_view, quiz_started, quiz_completed, lead_capture_submitted-Analog).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, Sparkles, ShieldCheck, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trackFunnel, getAnonymousId, getSessionId } from "@/lib/conversionTracking";

const PAINPOINTS: { key: string; label: string; hint: string }[] = [
  { key: "ausbildung_ihk", label: "IHK-Prüfungsvorbereitung effizienter machen", hint: "AEVO / Azubi-Pool" },
  { key: "onboarding", label: "Onboarding strukturieren & messbar machen", hint: "Erste 90 Tage" },
  { key: "compliance_schulung", label: "Pflicht-Compliance-Schulungen nachweisbar abwickeln", hint: "Audit-ready" },
  { key: "mitarbeiterentwicklung", label: "Mitarbeiter:innen-Entwicklung pro Kompetenz steuern", hint: "Lern-Loop" },
  { key: "konflikte", label: "Kommunikations-/Konfliktkompetenz trainieren", hint: "Simulation" },
  { key: "kuendigungsgespraech", label: "Schwierige Gespräche professionell vorbereiten", hint: "Führung" },
];

type Stage = "idle" | "streaming" | "done" | "error";

interface MetaPayload {
  package_id: string;
  package_title: string;
  package_key?: string;
  track?: string | null;
  matches?: Array<{ package_id: string; package_title: string; score?: number; track?: string }>;
}

export default function DemoHrPage() {
  const [painpoint, setPainpoint] = useState<string>(PAINPOINTS[0].key);
  const [role, setRole] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [text, setText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track lead_magnet_view einmal beim Mount.
  useEffect(() => {
    trackFunnel("lead_magnet_view", {
      source_page: "/demo/hr",
      persona: "hr",
      metadata: { demo_variant: "hr_hybrid_v1" },
    });
    return () => abortRef.current?.abort();
  }, []);

  const selectedPainpoint = useMemo(
    () => PAINPOINTS.find((p) => p.key === painpoint),
    [painpoint],
  );

  async function run() {
    setStage("streaming");
    setMeta(null);
    setText("");
    let metaLocal: MetaPayload | null = null;
    setErrorMsg(null);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    void trackFunnel("quiz_started", {
      source_page: "/demo/hr",
      persona: "hr",
      package_id: null,
      metadata: { painpoint_key: painpoint, role, company_size: companySize, demo_variant: "hr_hybrid_v1" },
    });

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hr-demo-personalize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            painpoint_key: painpoint,
            anonymous_id: getAnonymousId(),
            session_id: getSessionId(),
            role: role || null,
            company_size: companySize || null,
          }),
          signal: controller.signal,
        },
      );

      if (!resp.ok || !resp.body) {
        let msg = "Demo konnte nicht geladen werden.";
        try {
          const j = await resp.json();
          if (resp.status === 429) msg = j.message ?? "Rate-Limit erreicht.";
          else if (resp.status === 402) msg = "AI-Kontingent ist aktuell erschöpft.";
          else if (resp.status === 404) msg = j.message ?? "Kein passendes Paket gefunden.";
          else if (j?.message) msg = j.message;
        } catch { /* ignore */ }
        setErrorMsg(msg);
        setStage("error");
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assembled = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE-Frames sind "\n\n"-getrennt; meta-event + data-events
        let sepIdx: number;
        while ((sepIdx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sepIdx);
          buf = buf.slice(sepIdx + 2);
          const lines = frame.split("\n");
          let eventName = "message";
          const dataParts: string[] = [];
          for (const ln of lines) {
            if (ln.startsWith("event: ")) eventName = ln.slice(7).trim();
            else if (ln.startsWith("data: ")) dataParts.push(ln.slice(6));
          }
          const dataStr = dataParts.join("\n");
          if (!dataStr) continue;
          if (eventName === "meta") {
            try {
              const parsed = JSON.parse(dataStr) as MetaPayload;
              metaLocal = parsed;
              setMeta(parsed);
            } catch { /* ignore */ }
            continue;
          }
          if (dataStr === "[DONE]") continue;
          try {
            const j = JSON.parse(dataStr);
            const delta = j?.choices?.[0]?.delta?.content;
            if (delta) {
              assembled += delta;
              setText(assembled);
            }
          } catch { /* partial */ }
        }
      }

      setStage("done");
      void trackFunnel("quiz_completed", {
        source_page: "/demo/hr",
        persona: "hr",
        package_id: meta?.package_id ?? null,
        metadata: { painpoint_key: painpoint, chars: assembled.length, demo_variant: "hr_hybrid_v1" },
      });
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      console.error("[demo/hr] stream failed", e);
      setErrorMsg("Verbindungsfehler. Bitte später erneut versuchen.");
      setStage("error");
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>HR Activation Demo · BerufOS für Ausbildungsleiter:innen</title>
        <meta
          name="description"
          content="Beschreibe deinen HR-Painpoint in 15 Sekunden — BerufOS zeigt das passende Lernpaket plus 3-Schritte-Aktivierungsplan, AI-personalisiert."
        />
        <link rel="canonical" href="/demo/hr" />
        <meta name="robots" content="index,follow" />
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-14 pb-8">
        <Badge variant="secondary" className="mb-4">Live-Demo · Persona HR & Ausbildung</Badge>
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
          Vom Painpoint zum 3-Schritte-Aktivierungsplan — in 60 Sekunden.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Wähle einen typischen HR-Painpoint. BerufOS matcht in Echtzeit ein veröffentlichtes
          Lernpaket aus dem Kompetenz-Graph und personalisiert den Einstieg.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Keine Anmeldung</span>
          <span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> AI-personalisiert</span>
          <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4" /> Für HR & Ausbildungsleitung</span>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16 grid gap-6 lg:grid-cols-5">
        {/* Input-Spalte */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>1 · Painpoint wählen</CardTitle>
            <CardDescription>15 Sekunden. Optional zwei Kontext-Felder.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <fieldset className="space-y-2" aria-label="Painpoint auswählen">
              <legend className="sr-only">Painpoint auswählen</legend>
              {PAINPOINTS.map((p) => {
                const isActive = p.key === painpoint;
                return (
                  <label
                    key={p.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition ${
                      isActive ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                    }`}
                  >
                    <input
                      type="radio"
                      name="painpoint"
                      value={p.key}
                      checked={isActive}
                      onChange={() => setPainpoint(p.key)}
                      className="mt-1 h-4 w-4 accent-current"
                      aria-describedby={`pp-hint-${p.key}`}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium leading-snug">{p.label}</span>
                      <span id={`pp-hint-${p.key}`} className="block text-xs text-muted-foreground">{p.hint}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role">Rolle (optional)</Label>
                <Input
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="z. B. Ausbildungsleiter:in"
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company_size">Größe (optional)</Label>
                <Input
                  id="company_size"
                  value={companySize}
                  onChange={(e) => setCompanySize(e.target.value)}
                  placeholder="z. B. 250 MA"
                  maxLength={40}
                />
              </div>
            </div>

            <Button
              onClick={run}
              disabled={stage === "streaming"}
              size="lg"
              className="w-full"
              aria-label="Personalisierten Aktivierungsplan starten"
            >
              {stage === "streaming" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wird personalisiert …</>
              ) : (
                <>Aktivierungsplan starten <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Output-Spalte */}
        <div className="lg:col-span-3 space-y-4" aria-live="polite" aria-busy={stage === "streaming"}>
          {stage === "idle" && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Wähle links einen Painpoint und starte. Du siehst hier in &lt; 3 Sekunden ein
                Match-Paket und den personalisierten 3-Schritte-Plan.
              </CardContent>
            </Card>
          )}

          {errorMsg && (
            <Alert variant="destructive">
              <AlertTitle>Demo nicht verfügbar</AlertTitle>
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          {meta && (
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Kuratiertes Match aus dem Kompetenz-Graph</CardDescription>
                <CardTitle className="text-xl">{meta.package_title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  {meta.track && <Badge variant="outline">Track: {meta.track}</Badge>}
                  {selectedPainpoint && <Badge variant="secondary">Painpoint: {selectedPainpoint.label}</Badge>}
                </div>
                {meta.matches && meta.matches.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    +{meta.matches.length - 1} weitere Paket-Vorschläge im Hintergrund priorisiert.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {(stage === "streaming" || stage === "done") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> Personalisierter Aktivierungsplan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground"
                  data-testid="demo-hr-output"
                >
                  {text || (stage === "streaming" ? "Wird generiert …" : "")}
                  {stage === "streaming" && (
                    <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-primary align-middle" aria-hidden />
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {stage === "done" && meta && (
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link
                  to={`/pakete/${meta.package_key ?? meta.package_id}`}
                  onClick={() => {
                    void trackFunnel("hero_cta_click", {
                      source_page: "/demo/hr",
                      persona: "hr",
                      package_id: meta.package_id,
                      metadata: { cta: "view_package", painpoint_key: painpoint },
                    });
                  }}
                >
                  Paket im Detail ansehen <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link
                  to="/betriebe"
                  onClick={() => {
                    void trackFunnel("hero_cta_click", {
                      source_page: "/demo/hr",
                      persona: "hr",
                      package_id: meta.package_id,
                      metadata: { cta: "talk_to_sales", painpoint_key: painpoint },
                    });
                  }}
                >
                  Mit dem Vertrieb sprechen
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
