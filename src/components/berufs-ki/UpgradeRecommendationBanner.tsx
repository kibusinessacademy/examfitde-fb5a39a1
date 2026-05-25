/**
 * Berufs-KI Upgrade Recommendation Banner (BK-Act-2).
 *
 * Deterministisches Upgrade-Signal — keine statische Pricing-Karte.
 * Zeigt nur an, wenn das Backend explizit `upgrade_pro` oder
 * `upgrade_business` empfiehlt. Trackt einmal pro Mount.
 */
import { useEffect, useRef } from "react";
import { ArrowRight, Sparkles, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWorkflowUpgradeSignal } from "@/hooks/useBerufsKiRevenueUX";
import { trackUpgradeSignalShown } from "@/lib/berufs-ki/revenue";

export function UpgradeRecommendationBanner() {
  const { data } = useWorkflowUpgradeSignal();
  const tracked = useRef(false);

  useEffect(() => {
    if (!data || tracked.current) return;
    if (data.recommendation === "upgrade_pro" || data.recommendation === "upgrade_business") {
      tracked.current = true;
      void trackUpgradeSignalShown(data);
    }
  }, [data]);

  if (!data) return null;
  if (data.recommendation !== "upgrade_pro" && data.recommendation !== "upgrade_business") return null;

  const isBusiness = data.recommendation === "upgrade_business";

  return (
    <Card className="border-primary/40 bg-gradient-to-r from-primary/10 via-primary/5 to-background">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {isBusiness ? <Users className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-sm font-semibold">{data.human_label}</div>
              {data.reasons.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {data.reasons.slice(0, 3).map((r, i) => (
                    <li key={i}>· {r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {isBusiness ? (
              <Button asChild>
                <Link to="/work">Business-Lizenz prüfen <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/paket">Pro freischalten <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
