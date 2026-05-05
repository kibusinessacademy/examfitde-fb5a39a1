/**
 * MarketingIntelligencePanel — Sub-Page für Growth → Marketing Intelligence.
 * Zeigt CRM/Orders/Email-Daten konsolidiert mit Diagnose und Fix-CTAs.
 *
 * Tabellen-Coverage:
 *   - orders, order_items, conversion_events
 *   - crm_contacts, crm_deals, crm_activities
 *   - leads, b2b_leads, partner_leads, sales_leads
 *   - newsletter_subscribers, newsletter_campaigns
 *   - email_campaigns, email_sequences, lead_magnets
 *
 * Jeder Bereich liefert: KPI, "Health Status", konkrete Lücke + Fix-CTA.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  ShoppingCart,
  Users,
  Mail,
  Magnet,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Target,
  ArrowRight,
} from 'lucide-react';
import CrmDealsDrilldown from './CrmDealsDrilldown';
import EmailSequencesPanel from './EmailSequencesPanel';
import SalesFunnelCard from './SalesFunnelCard';
import E2EBundleCheckCard from './E2EBundleCheckCard';

type Health = 'critical' | 'warning' | 'ok' | 'unknown';

const HEALTH_TONE: Record<Health, string> = {
  critical: 'bg-destructive-bg-subtle text-destructive border-destructive/30',
  warning: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  ok: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  unknown: 'bg-muted text-muted-foreground border-muted',
};

function HealthBadge({ status, label }: { status: Health; label?: string }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${HEALTH_TONE[status]}`}>
      {label ?? status.toUpperCase()}
    </Badge>
  );
}

function FixCTA({ label, to, href, onClick }: { label: string; to?: string; href?: string; onClick?: () => void }) {
  if (to) {
    return (
      <Button asChild size="sm" variant="default" className="gap-1.5 h-7 text-xs">
        <Link to={to}>{label} <ArrowRight className="h-3 w-3" /></Link>
      </Button>
    );
  }
  if (href) {
    return (
      <Button asChild size="sm" variant="default" className="gap-1.5 h-7 text-xs">
        <a href={href} target="_blank" rel="noreferrer">{label} <ArrowRight className="h-3 w-3" /></a>
      </Button>
    );
  }
  return (
    <Button size="sm" variant="default" className="gap-1.5 h-7 text-xs" onClick={onClick}>
      {label} <ArrowRight className="h-3 w-3" />
    </Button>
  );
}

async function fetchOverview() {
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const counts = async (table: string, filter?: { gte?: { col: string; val: string } }) => {
    let q = (supabase as any).from(table).select('*', { count: 'exact', head: true });
    if (filter?.gte) q = q.gte(filter.gte.col, filter.gte.val);
    const { count, error } = await q;
    if (error) return { count: 0, error: error.message };
    return { count: count ?? 0 };
  };

  const [
    orders,
    orders30d,
    orderItems,
    crmContacts,
    crmDeals,
    crmActivities,
    leads,
    b2bLeads,
    partnerLeads,
    newsletterSubs,
    newsletterCamp,
    emailCamp,
    emailSeq,
    leadMagnets,
    convEvents,
    convEvents7d,
  ] = await Promise.all([
    counts('orders'),
    counts('orders', { gte: { col: 'created_at', val: since30d } }),
    counts('order_items'),
    counts('crm_contacts'),
    counts('crm_deals'),
    counts('crm_activities'),
    counts('leads'),
    counts('b2b_leads'),
    counts('partner_leads'),
    counts('newsletter_subscribers'),
    counts('newsletter_campaigns'),
    counts('email_campaigns'),
    counts('email_sequences'),
    counts('lead_magnets'),
    counts('conversion_events'),
    counts('conversion_events', { gte: { col: 'created_at', val: since7d } }),
  ]);

  // Sample top leads / latest deals for table previews
  const { data: latestB2b } = await (supabase as any)
    .from('b2b_leads')
    .select('id,company_name,contact_email,status,deal_value_eur,created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: latestSequences } = await (supabase as any)
    .from('email_sequences')
    .select('id,name,is_active,trigger_event,created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: latestMagnets } = await (supabase as any)
    .from('lead_magnets')
    .select('id,title,slug,is_active,download_count,created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  return {
    orders, orders30d, orderItems,
    crmContacts, crmDeals, crmActivities,
    leads, b2bLeads, partnerLeads,
    newsletterSubs, newsletterCamp,
    emailCamp, emailSeq, leadMagnets,
    convEvents, convEvents7d,
    latestB2b: latestB2b ?? [],
    latestSequences: latestSequences ?? [],
    latestMagnets: latestMagnets ?? [],
  };
}

export default function MarketingIntelligencePanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['marketing-intelligence-overview'],
    queryFn: fetchOverview,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---- Diagnose-Logik ----
  const ordersHealth: Health = data.orders.count === 0 ? 'critical' : data.orders30d.count === 0 ? 'warning' : 'ok';
  const crmHealth: Health = data.crmContacts.count === 0 ? 'critical' : data.crmDeals.count === 0 ? 'warning' : 'ok';
  const emailHealth: Health =
    data.emailCamp.count === 0 && data.newsletterCamp.count === 0
      ? 'critical'
      : data.newsletterSubs.count === 0
        ? 'warning'
        : 'ok';
  const trackingHealth: Health = data.convEvents.count === 0 ? 'critical' : data.convEvents7d.count < 10 ? 'warning' : 'ok';
  const leadsHealth: Health = (data.leads.count + data.b2bLeads.count) === 0 ? 'critical' : 'warning';

  return (
    <div className="space-y-5">
      {/* Header / Master-Diagnose */}
      <Alert className={ordersHealth === 'critical' || crmHealth === 'critical' ? 'border-destructive/40 bg-destructive-bg-subtle' : ''}>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-sm font-semibold">Marketing-Stack Master-Diagnose</AlertTitle>
        <AlertDescription className="text-xs space-y-1.5 mt-1.5">
          <div className="flex flex-wrap gap-3">
            <span>Sales Funnel: <HealthBadge status={ordersHealth} /></span>
            <span>CRM: <HealthBadge status={crmHealth} /></span>
            <span>Email: <HealthBadge status={emailHealth} /></span>
            <span>Tracking: <HealthBadge status={trackingHealth} /></span>
            <span>Leads: <HealthBadge status={leadsHealth} /></span>
          </div>
          <div className="text-muted-foreground">
            Roh-Datenbasis aus 16 Tabellen aggregiert (orders, order_items, crm_*, leads, *_leads,
            newsletter_*, email_*, lead_magnets, conversion_events). Refresh alle 60s.
          </div>
        </AlertDescription>
      </Alert>

      {/* KPI-Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile icon={<ShoppingCart className="h-3.5 w-3.5" />} label="Orders gesamt" value={data.orders.count} sub={`${data.orders30d.count} (30d)`} health={ordersHealth} />
        <KpiTile icon={<Users className="h-3.5 w-3.5" />} label="CRM Contacts" value={data.crmContacts.count} sub={`${data.crmDeals.count} Deals`} health={crmHealth} />
        <KpiTile icon={<Mail className="h-3.5 w-3.5" />} label="Newsletter Subs" value={data.newsletterSubs.count} sub={`${data.newsletterCamp.count} Campaigns`} health={emailHealth} />
        <KpiTile icon={<TrendingUp className="h-3.5 w-3.5" />} label="Conversion Events" value={data.convEvents.count} sub={`${data.convEvents7d.count} (7d)`} health={trackingHealth} />
        <KpiTile icon={<Target className="h-3.5 w-3.5" />} label="B2B Leads" value={data.b2bLeads.count} sub={`${data.leads.count} B2C · ${data.partnerLeads.count} Partner`} health={leadsHealth} />
        <KpiTile icon={<Magnet className="h-3.5 w-3.5" />} label="Lead Magnets" value={data.leadMagnets.count} sub={`${data.emailSeq.count} Email-Sequences`} health="ok" />
        <KpiTile icon={<Mail className="h-3.5 w-3.5" />} label="Email Campaigns" value={data.emailCamp.count} sub={`${data.emailSeq.count} Sequences`} health={data.emailCamp.count === 0 ? 'critical' : 'ok'} />
        <KpiTile icon={<ShoppingCart className="h-3.5 w-3.5" />} label="Order Items" value={data.orderItems.count} sub={`Ø ${data.orders.count > 0 ? (data.orderItems.count / data.orders.count).toFixed(1) : '0'}/Order`} health={ordersHealth} />
      </div>

      {/* Section: Orders / Funnel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            Orders &amp; Conversion Funnel
            <HealthBadge status={ordersHealth} />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-3">
          {data.orders.count === 0 ? (
            <DiagBlock
              tone="critical"
              title="Kein Order-Funnel aktiv (orders=0)"
              detail="Es wurden bisher 0 Orders erfasst. Die Tabellen orders, order_items und checkout_sessions sind leer. Das Verkaufssystem ist nicht operativ."
              fixes={[
                { label: 'Stripe Checkout konfigurieren', href: '/admin/command/growth?tab=pricing' },
                { label: 'Pricing-Seiten prüfen', href: '/preise' },
              ]}
            />
          ) : (
            <DiagBlock tone="ok" title={`${data.orders.count} Orders aktiv`} detail={`${data.orders30d.count} in den letzten 30 Tagen.`} />
          )}
          {data.convEvents.count === 0 && (
            <DiagBlock
              tone="critical"
              title="Conversion-Tracking nicht aktiv (conversion_events=0)"
              detail="Keine Conversion-Events erfasst. Tracking-Pixel und Event-Hooks sollten in Hero, Pricing-CTAs und Checkout instrumentiert werden."
              fixes={[{ label: 'Tracking instrumentieren', href: '/admin/command/growth?tab=settings' }]}
            />
          )}
        </CardContent>
      </Card>

      {/* Section: CRM */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            CRM (Contacts · Deals · Activities)
            <HealthBadge status={crmHealth} />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-3">
          {data.crmContacts.count === 0 ? (
            <DiagBlock
              tone="critical"
              title="CRM komplett leer (crm_contacts=0, crm_deals=0)"
              detail="Keine Contacts, keine Deals, keine Activities. Nutze Lead-Magnets und Newsletter-Signups als Eingangskanal — die müssen in crm_contacts importiert werden."
              fixes={[
                { label: 'Lead Magnets prüfen', href: '/admin/command/growth?tab=growth' },
                { label: 'Newsletter Imports', href: '/admin/command/growth?tab=growth' },
              ]}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Mini label="Contacts" value={data.crmContacts.count} />
              <Mini label="Deals" value={data.crmDeals.count} />
              <Mini label="Activities" value={data.crmActivities.count} />
            </div>
          )}

          {data.b2bLeads.count > 0 && (
            <div>
              <div className="font-medium mb-1.5">Letzte B2B Leads</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-7 text-[10px]">Firma</TableHead>
                    <TableHead className="h-7 text-[10px]">Kontakt</TableHead>
                    <TableHead className="h-7 text-[10px]">Status</TableHead>
                    <TableHead className="h-7 text-[10px] text-right">Wert</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.latestB2b.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="py-1 text-[11px]">{l.company_name ?? '—'}</TableCell>
                      <TableCell className="py-1 text-[11px] font-mono">{l.contact_email ?? '—'}</TableCell>
                      <TableCell className="py-1"><Badge variant="outline" className="text-[9px]">{l.status ?? 'neu'}</Badge></TableCell>
                      <TableCell className="py-1 text-[11px] text-right">{l.deal_value_eur ? `${l.deal_value_eur} €` : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section: Sales Funnel pro Curriculum (30d) — Schritte + Latenz */}
      <SalesFunnelCard />

      {/* Section: E2E Produkttest (Bundle-only, DB-only) */}
      <E2EBundleCheckCard />

      {/* Section: CRM Deals Drilldown — pro Deal Orders/Activities/Email-Sequences */}
      <CrmDealsDrilldown />

      {/* Section: Email Sequences (Loop B) — Live-Versandstatus */}
      <EmailSequencesPanel />

      {/* Section: Email */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            Email Marketing (Sequences · Campaigns · Subscribers)
            <HealthBadge status={emailHealth} />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-3">
          {data.emailCamp.count === 0 && data.newsletterCamp.count === 0 && (
            <DiagBlock
              tone="critical"
              title="Keine Email-Campaign jemals gesendet"
              detail={`${data.emailSeq.count} Sequences sind angelegt aber 0 wurden gesendet. Newsletter-Subscriber: ${data.newsletterSubs.count}.`}
              fixes={[{ label: 'Email-Sequences aktivieren', href: '/admin/command/growth?tab=growth' }]}
            />
          )}
          {data.newsletterSubs.count === 0 && (
            <DiagBlock
              tone="warning"
              title="Keine Newsletter-Subscriber"
              detail="Footer-Optin und Lead-Magnets müssen Subscriber generieren. Double-Optin-Flow validieren."
            />
          )}
          {data.latestSequences.length > 0 && (
            <div>
              <div className="font-medium mb-1.5">Email Sequences</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-7 text-[10px]">Name</TableHead>
                    <TableHead className="h-7 text-[10px]">Trigger</TableHead>
                    <TableHead className="h-7 text-[10px]">Aktiv</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.latestSequences.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="py-1 text-[11px]">{s.name}</TableCell>
                      <TableCell className="py-1 text-[11px] font-mono">{s.trigger_event ?? '—'}</TableCell>
                      <TableCell className="py-1">
                        {s.is_active ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Badge variant="outline" className="text-[9px]">aus</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section: Lead Magnets */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Magnet className="h-4 w-4 text-primary" />
            Lead Magnets &amp; Top of Funnel
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-3">
          {data.latestMagnets.length === 0 ? (
            <DiagBlock tone="warning" title="Keine Lead Magnets" detail="Top-of-Funnel-Assets fehlen für Subscriber-Akquise." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7 text-[10px]">Titel</TableHead>
                  <TableHead className="h-7 text-[10px]">Slug</TableHead>
                  <TableHead className="h-7 text-[10px]">Aktiv</TableHead>
                  <TableHead className="h-7 text-[10px] text-right">Downloads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.latestMagnets.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="py-1 text-[11px]">{m.title}</TableCell>
                    <TableCell className="py-1 text-[10px] font-mono text-muted-foreground">/{m.slug}</TableCell>
                    <TableCell className="py-1">
                      {m.is_active ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Badge variant="outline" className="text-[9px]">aus</Badge>}
                    </TableCell>
                    <TableCell className="py-1 text-[11px] text-right">{m.download_count ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section: Master Action Plan */}
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Priorisierter Fix-Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          <ActionStep
            n={1}
            done={data.orders.count > 0}
            title="Order-Funnel aktivieren"
            detail="Stripe Checkout testen, mind. 1 Test-Order durchziehen, conversion_events bei checkout.completed feuern."
            cta={<FixCTA label="Pricing/Checkout" href="/admin/command/growth?tab=pricing" />}
          />
          <ActionStep
            n={2}
            done={data.convEvents7d.count >= 10}
            title="Tracking instrumentieren"
            detail={`Aktuell ${data.convEvents7d.count} Events in 7 Tagen. Ziel: ≥10/Tag durch Hero-CTA, Pricing-Click, Quiz-Submit.`}
            cta={<FixCTA label="Tracking-Settings" href="/admin/command/growth?tab=settings" />}
          />
          <ActionStep
            n={3}
            done={data.crmContacts.count > 0}
            title="CRM mit Lead-Magnets befüllen"
            detail="Lead-Magnet-Downloads müssen Contacts in crm_contacts erzeugen (lifecycle_stage=lead, lead_source=magnet)."
            cta={<FixCTA label="Growth Loop" href="/admin/command/growth?tab=growth" />}
          />
          <ActionStep
            n={4}
            done={data.newsletterSubs.count > 0}
            title="Newsletter-Optin live"
            detail="Footer-Optin + Double-Optin-Flow funktional, Subscriber landen in newsletter_subscribers."
            cta={<FixCTA label="Newsletter" href="/admin/command/growth?tab=growth" />}
          />
          <ActionStep
            n={5}
            done={data.emailCamp.count > 0 || data.newsletterCamp.count > 0}
            title="Erste Email-Campaign senden"
            detail={`${data.emailSeq.count} Sequences existieren — mindestens eine Welcome-Sequence aktivieren.`}
            cta={<FixCTA label="Email Sequences" href="/admin/command/growth?tab=growth" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function KpiTile({
  icon, label, value, sub, health,
}: { icon: React.ReactNode; label: string; value: number; sub: string; health: Health }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-1.5 mb-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground font-medium">
            {icon} {label}
          </div>
          <HealthBadge status={health} />
        </div>
        <div className="text-2xl font-bold tabular-nums">{value.toLocaleString('de-DE')}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value.toLocaleString('de-DE')}</div>
    </div>
  );
}

function DiagBlock({
  tone, title, detail, fixes,
}: {
  tone: 'critical' | 'warning' | 'ok';
  title: string;
  detail: string;
  fixes?: Array<{ label: string; href?: string; to?: string; onClick?: () => void }>;
}) {
  const toneCls = tone === 'critical'
    ? 'border-destructive/40 bg-destructive-bg-subtle'
    : tone === 'warning' ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5';
  return (
    <div className={`rounded-md border ${toneCls} p-3`}>
      <div className="font-semibold text-[11px] mb-0.5">{title}</div>
      <div className="text-[11px] text-muted-foreground mb-2">{detail}</div>
      {fixes && fixes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {fixes.map((f, i) => <FixCTA key={i} {...f} />)}
        </div>
      )}
    </div>
  );
}

function ActionStep({
  n, done, title, detail, cta,
}: { n: number; done: boolean; title: string; detail: string; cta: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border bg-background p-2.5">
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-emerald-500/15 text-emerald-700' : 'bg-primary/15 text-primary'}`}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[11px]">{title}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{detail}</div>
      </div>
      <div className="shrink-0">{cta}</div>
    </div>
  );
}
