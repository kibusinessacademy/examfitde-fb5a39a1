/**
 * PackageDiagnosticsPage
 * ──────────────────────
 * Phase 2: Vollbild-Diagnose-Cockpit für ein einzelnes Paket.
 * Route: /admin/heal-cockpit/package/:packageId
 */
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PackageDiagnostics } from "@/components/admin/heal/PackageDiagnostics";
import { OralSeedDiagnosticsCard } from "@/components/admin/heal/OralSeedDiagnosticsCard";

export default function PackageDiagnosticsPage() {
  const { packageId } = useParams<{ packageId: string }>();

  if (!packageId) {
    return (
      <div className="p-6 text-sm text-destructive">
        Paket-ID fehlt. <Link to="/admin/heal-cockpit" className="underline">Zurück zum Heal-Cockpit</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Helmet>
        <title>Paket-Diagnose · {packageId.slice(0, 8)} · Admin</title>
        <meta name="description" content="Live-Queue, Root-Cause, Reports und Rollback für ein einzelnes Paket." />
      </Helmet>

      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Paket-Diagnose</h1>
            <p className="font-mono text-xs text-muted-foreground">{packageId}</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/heal-cockpit">
            <ArrowLeft className="mr-1.5 h-3 w-3" /> Heal-Cockpit
          </Link>
        </Button>
      </header>

      <PackageDiagnostics packageId={packageId} />
    </div>
  );
}
