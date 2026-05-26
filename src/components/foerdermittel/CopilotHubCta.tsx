import { Link } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function CopilotHubCta() {
  return (
    <Card className="border-primary/30 bg-gradient-to-br from-background to-primary/[0.04]">
      <CardContent className="p-5 flex items-start gap-4">
        <div className="rounded-md bg-primary/10 p-2.5">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold">Fördermittel CoPilot</h3>
            <Badge variant="outline" className="text-[10px]">grounded</Badge>
            <Badge variant="outline" className="text-[10px]">Premium</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            KI-gestützte Förderentscheidung auf Basis von Matching, Aktualitätsprüfung und
            Antragstimeline. Auf jeder Programmseite verfügbar — kein freier Chat, sondern
            vordefinierte, geprüfte Aktionen.
          </p>
          <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
            <div>› Warum passt diese Förderung?</div>
            <div>› Welche Unterlagen fehlen?</div>
            <div>› Was ist der nächste Schritt?</div>
            <div>› Antragsgliederung vorbereiten</div>
          </div>
          <div className="mt-4 flex items-center gap-3 text-sm">
            <Link
              to="#matching"
              className="text-primary inline-flex items-center gap-1 hover:underline"
            >
              Erst Matching starten <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <span className="text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              Quellen &amp; Freshness immer sichtbar
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
