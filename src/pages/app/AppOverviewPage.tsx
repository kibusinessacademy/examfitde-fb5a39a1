import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, GraduationCap, Receipt, KeyRound, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAccountSummary } from './hooks/useAccountSummary';

function formatCents(cents: number, currency = 'EUR') {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);
}

export default function AppOverviewPage() {
  const { data, isLoading, error } = useAccountSummary();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }
  if (error) {
    return <Card><CardContent className="p-6 text-destructive">Fehler beim Laden: {(error as Error).message}</CardContent></Card>;
  }

  const s = data!;
  const activeCount = s.active_courses?.length ?? 0;
  const licCount = s.license_packages_owned?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Mein Account</h2>
          <p className="text-sm text-text-secondary mt-1">Übersicht über Kurse, Rechnungen, Lizenzen und Datenschutz.</p>
        </div>
        <Button asChild variant="petrol">
          <Link to="/dashboard">Zum Lernen <ArrowRight className="ml-1 h-4 w-4" /></Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card variant="interactive">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Aktive Kurse</CardTitle>
              <Badge variant="secondary">{activeCount}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {activeCount === 0 ? (
              <p className="text-sm text-text-secondary">Noch keine aktiven Kurse.</p>
            ) : (
              <ul className="space-y-2">
                {s.active_courses.slice(0, 3).map((c) => (
                  <li key={c.grant_id} className="text-sm text-text-primary">{c.package_name}</li>
                ))}
              </ul>
            )}
            <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/meine-kurse">Alle ansehen</Link></Button>
          </CardContent>
        </Card>

        <Card variant="interactive">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Letzte Rechnung</CardTitle>
              <Badge variant="secondary">{s.invoice_count}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {s.latest_invoice ? (
              <div className="text-sm space-y-1">
                <div className="text-text-primary font-medium">{s.latest_invoice.invoice_number ?? s.latest_invoice.id.slice(0, 8)}</div>
                <div className="text-text-secondary">{formatCents(s.latest_invoice.total_cents, s.latest_invoice.currency)} · {s.latest_invoice.status}</div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">Noch keine Rechnungen.</p>
            )}
            <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/rechnungen">Alle Rechnungen</Link></Button>
          </CardContent>
        </Card>

        <Card variant="interactive">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> Aktive Lizenzen</CardTitle>
              <Badge variant="secondary">{licCount}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {licCount === 0 ? (
              <p className="text-sm text-text-secondary">Keine Lizenzen vorhanden.</p>
            ) : (
              <ul className="space-y-2">
                {s.license_packages_owned.slice(0, 3).map((l) => (
                  <li key={l.package_id} className="text-sm">
                    <span className="text-text-primary">{l.package_name}</span>{' '}
                    <span className="text-text-muted">({l.seats_assigned}/{l.seats_total} Seats)</span>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/lizenzen">Lizenzen verwalten</Link></Button>
          </CardContent>
        </Card>

        <Card variant="interactive">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> DSGVO-Status</CardTitle>
          </CardHeader>
          <CardContent>
            {s.pending_gdpr_request ? (
              <div className="text-sm">
                <Badge variant="warning" className="mb-2">{s.pending_gdpr_request.status}</Badge>
                <p className="text-text-secondary">
                  {s.pending_gdpr_request.scheduled_deletion_at
                    ? `Löschung geplant: ${new Date(s.pending_gdpr_request.scheduled_deletion_at).toLocaleDateString('de-DE')}`
                    : 'Antrag wartet auf Bestätigung per E-Mail.'}
                </p>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">Keine offenen Anträge.</p>
            )}
            <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/dsgvo">Datenschutz verwalten</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
