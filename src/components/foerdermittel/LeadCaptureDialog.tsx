import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, ArrowRight, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import {
  buildConsentCopy,
  buildLeadMagnetOffer,
  buildReportKey,
  buildReportPath,
  computeLeadQualityScore,
  isBusinessEmail,
  sanitizeLeadPayload,
  type LeadSourcePage,
  type SanitizedReportContext,
} from "@/lib/foerdermittel/conversion";
import type { CompanyProfile, ProgramMatch } from "@/lib/foerdermittel/types";
import { useNavigate } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: LeadSourcePage;
  matches?: ReadonlyArray<ProgramMatch>;
  profile?: Partial<CompanyProfile> | null;
}

type Step = 0 | 1 | 2 | 3;

const REGIONS: { v: CompanyProfile["region"]; label: string }[] = [
  { v: "DE", label: "Deutschland (bundesweit)" },
  { v: "BW", label: "Baden-Württemberg" },
  { v: "BY", label: "Bayern" },
  { v: "BE", label: "Berlin" },
  { v: "BB", label: "Brandenburg" },
  { v: "HB", label: "Bremen" },
  { v: "HH", label: "Hamburg" },
  { v: "HE", label: "Hessen" },
  { v: "MV", label: "Mecklenburg-Vorpommern" },
  { v: "NI", label: "Niedersachsen" },
  { v: "NW", label: "Nordrhein-Westfalen" },
  { v: "RP", label: "Rheinland-Pfalz" },
  { v: "SL", label: "Saarland" },
  { v: "SN", label: "Sachsen" },
  { v: "ST", label: "Sachsen-Anhalt" },
  { v: "SH", label: "Schleswig-Holstein" },
  { v: "TH", label: "Thüringen" },
  { v: "EU", label: "EU-weit" },
];

const SIZES: { v: CompanyProfile["size"]; label: string }[] = [
  { v: "solo", label: "Solo / Selbstständig" },
  { v: "micro", label: "Mikro (1–9 MA)" },
  { v: "small", label: "Klein (10–49 MA)" },
  { v: "medium", label: "Mittel (50–249 MA)" },
  { v: "large", label: "Groß (250+ MA)" },
];

export function LeadCaptureDialog({ open, onOpenChange, source, matches = [], profile }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [size, setSize] = useState<CompanyProfile["size"] | "">(profile?.size ?? "");
  const [region, setRegion] = useState<CompanyProfile["region"] | "">(profile?.region ?? "");
  const [industry, setIndustry] = useState(profile?.industry ?? "");
  const [goal, setGoal] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offer = useMemo(() => {
    const staleCount = matches.filter((m) => m.warnings.length > 0).length;
    return buildLeadMagnetOffer({
      hasMatches: matches.length > 0,
      topCount: Math.min(matches.length, 5),
      staleCount,
      source,
    });
  }, [matches, source]);

  const consentCopy = useMemo(() => buildConsentCopy(source), [source]);

  const quality = useMemo(() => {
    return computeLeadQualityScore(
      matches,
      { ...profile, size: (size || profile?.size) as CompanyProfile["size"] | undefined, region: (region || profile?.region) as CompanyProfile["region"] | undefined, industry: industry || profile?.industry, topics: profile?.topics ?? [] },
      source,
    );
  }, [matches, profile, size, region, industry, source]);

  function reset() {
    setStep(0); setEmail(""); setCompany(""); setGoal(""); setConsent(false); setError(null);
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const reportContext: SanitizedReportContext = {
        topProgramSlugs: matches.slice(0, 5).map((m) => m.program.slug),
        averageFit: matches.length ? Math.round(matches.slice(0, 5).reduce((s, m) => s + m.fit, 0) / Math.min(matches.length, 5)) : 0,
        averageProbability: matches.length ? Math.round(matches.slice(0, 5).reduce((s, m) => s + m.probability, 0) / Math.min(matches.length, 5)) : 0,
        freshnessRiskCount: matches.filter((m) => m.warnings.length > 0).length,
      };

      const sanitized = sanitizeLeadPayload({
        email,
        companyName: company,
        companySize: (size || undefined) as CompanyProfile["size"] | undefined,
        region: (region || undefined) as CompanyProfile["region"] | undefined,
        industry: industry || undefined,
        goal: goal || undefined,
        consentMarketing: consent,
        source,
        requestId,
        reportContext,
      });

      if (!sanitized.ok || !sanitized.cleaned) {
        setError(sanitized.errors[0] === "invalid_email" ? "Bitte gültige E-Mail eingeben." : "Bitte alle Pflichtfelder ausfüllen.");
        setSubmitting(false);
        return;
      }

      const { error: fnErr } = await supabase.functions.invoke("foerdermittel-lead-capture", {
        body: {
          ...sanitized.cleaned,
          leadQualityScore: quality.score,
          leadTier: quality.tier,
        },
      });
      if (fnErr) throw fnErr;

      const reportKey = buildReportKey(`${sanitized.cleaned.email}|${sanitized.cleaned.source}|${requestId}`);
      try {
        sessionStorage.setItem(`fmos.report.${reportKey}`, JSON.stringify({
          matches: matches.slice(0, 8).map((m) => ({ slug: m.program.slug, fit: m.fit, probability: m.probability })),
          profile: { size, region, industry },
          generatedAt: new Date().toISOString(),
          quality,
        }));
      } catch { /* storage may be unavailable */ }

      setStep(3);
      setTimeout(() => {
        onOpenChange(false);
        reset();
        navigate(buildReportPath(reportKey));
      }, 1200);
    } catch (e) {
      console.error("lead submit failed", e);
      setError("Übermittlung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setSubmitting(false);
    }
  }

  const businessHint = email && !isBusinessEmail(email);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <Badge variant="outline" className="w-fit mb-2">Fördermittel-Report</Badge>
          <DialogTitle className="text-xl">{offer.headline}</DialogTitle>
          <DialogDescription>{offer.subline}</DialogDescription>
        </DialogHeader>

        {step < 3 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
            {[0, 1, 2].map((s) => (
              <div key={s} className={`h-1 flex-1 rounded-full ${step >= s ? "bg-primary" : "bg-muted"}`} />
            ))}
            <span className="ml-2 tabular-nums">Schritt {step + 1}/3</span>
          </div>
        )}

        {step === 0 && (
          <div className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {offer.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Unternehmensgröße</Label>
                <select className="w-full border rounded-md p-2 text-sm bg-background" value={size} onChange={(e) => setSize(e.target.value as CompanyProfile["size"])}>
                  <option value="">Bitte wählen</option>
                  {SIZES.map((s) => (<option key={s.v} value={s.v}>{s.label}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bundesland</Label>
                <select className="w-full border rounded-md p-2 text-sm bg-background" value={region} onChange={(e) => setRegion(e.target.value as CompanyProfile["region"])}>
                  <option value="">Bitte wählen</option>
                  {REGIONS.map((r) => (<option key={r.v} value={r.v}>{r.label}</option>))}
                </select>
              </div>
            </div>
            <Button className="w-full" onClick={() => setStep(1)} disabled={!size || !region}>
              Weiter <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Branche (optional)</Label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="z. B. IT-Dienstleistung, Maschinenbau" maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Förderziel (optional)</Label>
              <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="z. B. KI-Pilotprojekt, Energieeffizienz, Mitarbeiterqualifizierung" maxLength={240} rows={3} />
              <div className="text-[10px] text-muted-foreground text-right">{goal.length}/240</div>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>Zurück</Button>
              <Button onClick={() => setStep(2)}>
                Weiter <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="lc-company" className="text-xs">Firmenname</Label>
              <Input id="lc-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Mustermann GmbH" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lc-email" className="text-xs">Geschäftliche E-Mail</Label>
              <Input id="lc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vorname.nachname@firma.de" maxLength={254} />
              {businessHint && (
                <div className="text-[11px] text-amber-700 dark:text-amber-400 inline-flex items-start gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3 mt-0.5" />
                  <span>Tipp: Mit einer Geschäfts-E-Mail erhalten Sie schnellere Bearbeitung.</span>
                </div>
              )}
            </div>
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="text-xs font-semibold inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                {consentCopy.headline}
              </div>
              <p className="text-[11px] text-muted-foreground">{consentCopy.body}</p>
              <label className="flex items-start gap-2 text-[11px] cursor-pointer">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                <span>{consentCopy.checkboxLabel}</span>
              </label>
              <p className="text-[10px] text-muted-foreground border-t pt-1.5">{consentCopy.privacyLine}</p>
            </div>
            {error && (
              <div className="text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded-md p-2">
                {error}
              </div>
            )}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} disabled={submitting}>Zurück</Button>
              <Button onClick={submit} disabled={!email || !consent || submitting}>
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Wird erstellt …</>
                ) : (
                  <>Report erstellen <ArrowRight className="h-4 w-4 ml-1" /></>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <div className="text-lg font-semibold">Report wird geöffnet …</div>
            <p className="text-sm text-muted-foreground">Wir senden Ihnen eine Kopie per E-Mail.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
