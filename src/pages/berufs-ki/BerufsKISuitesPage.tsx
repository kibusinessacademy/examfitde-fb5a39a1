/**
 * Berufs-KI Product Suites — Packaging-Layer.
 * Kuratierte Nutzen-Pakete; verlinkt auf existierende Activation-Pages.
 * Route: /berufs-ki/suites
 */
import { Link } from "react-router-dom";
import { ArrowRight, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProductSuites } from "@/hooks/useBerufsKIActivation";

export default function BerufsKISuitesPage() {
  const { data, isLoading } = useProductSuites();

  return (
    <div className="container space-y-6 py-8">
      <header>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">
          Berufs-KI · Produkt-Suiten
        </div>
        <h1 className="text-3xl font-bold leading-tight">Nutzen-Pakete für Ausbildung &amp; Workforce</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Vier kuratierte Suiten — jede bündelt die richtigen Cockpits, Automationen und Graph-Aktivierungen
          für eine konkrete Rolle.
        </p>
      </header>

      {isLoading && <div className="h-32 animate-pulse rounded-md bg-muted/30" />}

      <div className="grid gap-4 md:grid-cols-2">
        {(data ?? []).map((s) => (
          <Card key={s.id} className="border-primary/20 transition hover:border-primary/50 hover:shadow-elev-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-primary" />
                {s.name}
                <Badge variant="outline" className="ml-auto text-[10px]">{s.audience}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm font-medium">{s.tagline}</p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
              <div className="flex flex-wrap gap-1">
                {s.modules.map((m) => (
                  <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                ))}
              </div>
              <Button asChild size="sm" className="w-full sm:w-auto">
                <Link to={s.route}>Suite öffnen <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
