import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ProgramMatch } from "@/lib/foerdermittel/types";
import { REGION_LABEL } from "@/lib/foerdermittel/matching";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function ProgramCard({ match }: { match: ProgramMatch }) {
  const p = match.program;
  const max = p.funding.amountEurMax;
  const rate =
    p.funding.ratePctMax && p.funding.ratePctMin
      ? `${p.funding.ratePctMin}–${p.funding.ratePctMax} %`
      : p.funding.ratePctMax
        ? `bis ${p.funding.ratePctMax} %`
        : null;
  return (
    <Card className="overflow-hidden hover:shadow-elev-2 transition">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {p.authority} · {REGION_LABEL[p.region] ?? p.region}
            </div>
            <Link to={`/foerdermittel/programm/${p.slug}`} className="font-semibold hover:underline">
              {p.name}
            </Link>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums leading-none">{match.fit}</div>
            <div className="text-[10px] text-muted-foreground">Fit-Score</div>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{p.shortDescription}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {p.topics.slice(0, 4).map((t) => (
            <Badge key={t} variant="outline" className="text-[10px] capitalize">{t}</Badge>
          ))}
          <Badge variant="secondary" className="text-[10px] capitalize">{p.kind}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Max. Höhe</div>
            <div className="font-semibold tabular-nums">{max ? eur(max) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Förderquote</div>
            <div className="font-semibold tabular-nums">{rate ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Bewilligung</div>
            <div className="font-semibold tabular-nums">{match.probability} %</div>
          </div>
        </div>
        {(match.warnings.length > 0 || match.disqualifiers.length > 0) && (
          <div className="mt-3 space-y-1">
            {match.disqualifiers.map((d) => (
              <div key={d} className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{d}</span>
              </div>
            ))}
            {match.warnings.slice(0, 2).map((w) => (
              <div key={w} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        {match.reasons.slice(0, 2).map((r) => (
          <div key={r} className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-600 flex-shrink-0" />
            <span>{r}</span>
          </div>
        ))}
        <Link
          to={`/foerdermittel/programm/${p.slug}`}
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Details ansehen <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
