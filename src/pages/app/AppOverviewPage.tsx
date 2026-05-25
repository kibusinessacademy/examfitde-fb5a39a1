import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, GraduationCap, Receipt, KeyRound, ShieldCheck, Brain, Mic, Target } from 'lucide-react';
import { useAccountSummary } from './hooks/useAccountSummary';
import { AnticipationCard } from '@/components/os/AnticipationCard';
import { BerufIdentityChip } from '@/components/os/BerufIdentityChip';
import { useSystemConsciousness, readinessLabel } from '@/lib/system/SystemConsciousness';
import { useOsBeruf } from '@/lib/os/os-identity';
import { greetingFor } from '@/lib/os/os-copy';
import OSReactionLine from '@/components/os/OSReactionLine';


function formatCents(cents: number, currency = 'EUR') {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);
}

/**
 * /app — „Heute"-Briefing.
 *
 * OS-Default-View statt Karten-Wand. Drei Zeilen Briefing oben, eine primäre
 * Anticipation-Card, max. zwei sekundäre Hinweise. Konto-Tabellen erreichbar
 * über „Alles ansehen"-Toggle, niemals als Default.
 */
export default function AppOverviewPage() {
  const { data, isLoading, error, dataUpdatedAt } = useAccountSummary();
  const { readiness, topRisks, lastRecalc } = useSystemConsciousness();
  const beruf = useOsBeruf();
  const [showAll, setShowAll] = useState(false);
  const greeting = greetingFor();


  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-destructive">
          Ich konnte deinen Zustand gerade nicht laden: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const s = data!;
  const activeCount = s.active_courses?.length ?? 0;
  const top = topRisks(1)[0];
  const urgent = top?.tone === 'critical';
  const berufLabel = beruf?.short ?? beruf?.label ?? null;

  const briefing = urgent
    ? `Mir fällt auf — ${top.label.toLowerCase()}. Lass uns das jetzt angehen.`
    : `${readiness}% · ${readinessLabel(readiness)}. Heute nehmen wir uns das vor, was am meisten Punkte bringt.`;

  const primaryAction = activeCount > 0
    ? {
        kind: 'suggest' as const,
        statement: urgent
          ? `12 Minuten gezielt: ${top.label}.`
          : berufLabel
          ? `12 Minuten ${berufLabel} — ich führe dich durch deine schwächste Stelle.`
          : '12 Minuten Lernpfad — ich führe dich durch deine schwächste Stelle.',
        detail: 'Eine fokussierte Sequenz. Keine Tabs, keine Ablenkung.',
        action: { label: 'Lass uns starten', to: '/app/lernpfad' },
        icon: <Target className="h-3.5 w-3.5" />,
      }
    : {
        kind: 'plan' as const,
        statement: 'Lass uns deinen Prüfungszustand kalibrieren.',
        detail: '4 Minuten, keine Anmeldung, mit Quellen.',
        action: { label: 'Lass mich kurz draufschauen', to: '/pruefungscheck' },
        icon: <Brain className="h-3.5 w-3.5" />,
      };

  return (
    <div className="space-y-6">
      {/* Header — Identity statt Admin-Titel */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Heute</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-xl">
            {briefing}
          </p>
        </div>
        <BerufIdentityChip />
      </div>

      {/* Primäre Anticipation-Card */}
      <AnticipationCard
        kind={primaryAction.kind}
        statement={primaryAction.statement}
        detail={primaryAction.detail}
        action={primaryAction.action}
        icon={primaryAction.icon}
      />

      {/* Sekundäre Hinweise — max 2, ruhig */}
      <div className="grid gap-3 sm:grid-cols-2">
        <AnticipationCard
          kind="notice"
          statement={
            top
              ? `${top.label} — ich beobachte das.`
              : 'Mündlich übt sich gut zwischendurch.'
          }
          detail="5 Minuten Fachgespräch — wenn du magst."
          action={{ label: 'Mündlich starten', to: '/app/oral' }}
          icon={<Mic className="h-3.5 w-3.5" />}
        />
        <AnticipationCard
          kind="care"
          statement="Frag mich, wenn du irgendwo hängst."
          detail="Der Tutor hat Quellen — keine Halluzinationen."
          action={{ label: 'Tutor öffnen', to: '/app/tutor' }}
          icon={<Brain className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Konto-Drilldown — bewusst kollabiert, nie Default */}
      <div>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition"
        >
          {showAll ? '← Weniger anzeigen' : 'Mein Konto, Rechnungen, Lizenzen ansehen →'}
        </button>

        {showAll && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Aktive Kurse</CardTitle>
                  <Badge variant="secondary">{activeCount}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {activeCount === 0 ? (
                  <p className="text-sm text-muted-foreground">Noch keine aktiven Kurse.</p>
                ) : (
                  <ul className="space-y-2">
                    {s.active_courses.slice(0, 3).map((c) => (
                      <li key={c.grant_id} className="text-sm text-foreground">{c.package_name}</li>
                    ))}
                  </ul>
                )}
                <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/meine-kurse">Alle ansehen</Link></Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Letzte Rechnung</CardTitle>
                  <Badge variant="secondary">{s.invoice_count}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {s.latest_invoice ? (
                  <div className="text-sm space-y-1">
                    <div className="text-foreground font-medium">{s.latest_invoice.invoice_number ?? s.latest_invoice.id.slice(0, 8)}</div>
                    <div className="text-muted-foreground">{formatCents(s.latest_invoice.total_cents, s.latest_invoice.currency)} · {s.latest_invoice.status}</div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Noch keine Rechnungen.</p>
                )}
                <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/rechnungen">Alle Rechnungen</Link></Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> Lizenzen</CardTitle>
                  <Badge variant="secondary">{s.license_packages_owned?.length ?? 0}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/lizenzen">Lizenzen verwalten</Link></Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Datenschutz</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild variant="link" className="px-0 mt-2"><Link to="/app/dsgvo">Datenschutz verwalten</Link></Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
