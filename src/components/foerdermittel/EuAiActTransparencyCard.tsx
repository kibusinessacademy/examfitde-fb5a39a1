import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FOERDERMITTEL_AI_SYSTEMS,
  PURPOSE_LABEL,
  RISK_TIER_LABEL,
  summarizeAiAct,
} from "@/lib/foerdermittel/euAiAct";

export function EuAiActTransparencyCard() {
  const summary = summarizeAiAct();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          EU AI Act · Transparenz
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {summary.totalSystems} AI-System(e) im Einsatz · höchstes Risiko-Tier:{" "}
          <strong className="text-foreground">{RISK_TIER_LABEL[summary.highestRisk]}</strong>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {FOERDERMITTEL_AI_SYSTEMS.map((s) => (
          <div key={s.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold text-sm">{s.name}</div>
              <Badge variant="outline">{s.modelCategory}</Badge>
              <Badge variant="secondary">{RISK_TIER_LABEL[s.riskTier]}</Badge>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
              <div><span className="text-muted-foreground">Modell:</span> {s.model}</div>
              <div><span className="text-muted-foreground">Surface:</span> {s.surface}</div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Zweckbindung:</span>{" "}
                {s.purposes.map((p) => PURPOSE_LABEL[p]).join(" · ")}
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Grounding:</span>{" "}
                {s.groundingSources.join(" · ")}
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Aufsicht:</span> {s.humanOversight}
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Kennzeichnung:</span> {s.outputDisclosure}
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Verboten:</span>{" "}
                <ul className="list-disc list-inside text-foreground/80">
                  {s.prohibitedUses.map((u) => (<li key={u}>{u}</li>))}
                </ul>
              </div>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Risiko-Einstufung folgt dem Geist von EU AI Act Art. 5 + Annex III. Stand der Praxis-Implementierung
          wird laufend mit den TrustOS-Registries abgeglichen — keine Selbstzertifizierung als Hochrisiko-System.
        </p>
      </CardContent>
    </Card>
  );
}
