import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check } from "lucide-react";
import { topLevers, draftEmail, type NegotiationTone } from "@/lib/offer-comparison/negotiation";
import type { Project, RiskFinding } from "@/lib/offer-comparison/types";
import type { ScoredOffer } from "@/lib/offer-comparison/scoring";

const TONES: { id: NegotiationTone; label: string }[] = [
  { id: "neutral", label: "Neutral" },
  { id: "professionell", label: "Professionell" },
  { id: "partnerschaftlich", label: "Partnerschaftlich" },
  { id: "hart", label: "Hart" },
];

export function NegotiationPanel({ project, risks, scored }: { project: Project; risks: RiskFinding[]; scored: ScoredOffer[] }) {
  const candidates = useMemo(
    () => scored.filter((s) => s.score.labels.includes("negotiation_candidate") || s.score.labels.includes("best_overall")),
    [scored],
  );
  const [offerId, setOfferId] = useState<string>(candidates[0]?.offer.id ?? scored[0]?.offer.id);
  const [tone, setTone] = useState<NegotiationTone>("professionell");
  const [copied, setCopied] = useState(false);

  const offer = scored.find((s) => s.offer.id === offerId)?.offer;
  if (!offer) return null;

  const levers = topLevers(project, offer, risks);
  const email = draftEmail(project, offer, levers, tone);

  const copyEmail = async () => {
    await navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardContent className="p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Verhandlungsziel</div>
            <select
              value={offerId}
              onChange={(e) => setOfferId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {scored.map((s) => (
                <option key={s.offer.id} value={s.offer.id}>{s.offer.vendor} — {s.offer.productName}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Tonalität</div>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <Button key={t.id} size="sm" variant={tone === t.id ? "default" : "outline"} onClick={() => setTone(t.id)}>
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Top 5 Hebel</div>
            <ol className="space-y-2">
              {levers.map((l, i) => (
                <li key={l.id} className="rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="mt-0.5">{i + 1}</Badge>
                    <div className="flex-1">
                      <div className="font-medium">{l.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{l.argument}</div>
                      <div className="text-xs mt-1"><span className="text-primary font-medium">Ask:</span> {l.ask}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-3">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b p-3">
            <div className="text-sm font-medium">E-Mail-Entwurf · Copy-ready</div>
            <Button size="sm" variant="outline" onClick={copyEmail}>
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              {copied ? "Kopiert" : "Kopieren"}
            </Button>
          </div>
          <pre className="text-sm whitespace-pre-wrap p-5 leading-relaxed font-mono bg-muted/20 max-h-[420px] overflow-auto">{email}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
