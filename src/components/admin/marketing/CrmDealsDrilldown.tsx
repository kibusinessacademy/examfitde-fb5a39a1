/**
 * CrmDealsDrilldown — listet alle CRM Deals und öffnet pro Deal einen
 * Drawer mit:
 *   - Kontakt-Info
 *   - zugehörigen Orders (gematcht via product_ids ↔ order_items.license_package_id)
 *   - crm_activities (deal_id)
 *   - relevanten Email-Sequenz-Schritten (audience matched aus contact lifecycle_stage)
 *   - Fix-CTAs für jede Lücke (kein Kontakt, keine Activity, keine Sequence)
 *
 * Built nur auf vorhandenen Tabellen — keine neue DB-Struktur.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
  Users,
  ShoppingCart,
  Activity,
  Mail,
  ArrowRight,
  AlertTriangle,
  Inbox,
} from 'lucide-react';

type Deal = {
  id: string;
  title: string;
  stage: string;
  value_cents: number | null;
  currency: string | null;
  probability: number | null;
  contact_id: string | null;
  product_ids: string[] | null;
  expected_close_date: string | null;
  won: boolean | null;
  notes: string | null;
  created_at: string;
};

const STAGE_TONE: Record<string, string> = {
  qualification: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
  proposal: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  negotiation: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  won: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  lost: 'bg-destructive-bg-subtle text-destructive border-destructive/30',
};

export default function CrmDealsDrilldown() {
  const [search, setSearch] = useState('');
  const [openDealId, setOpenDealId] = useState<string | null>(null);

  const { data: deals, isLoading } = useQuery({
    queryKey: ['crm-deals-drilldown'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('crm_deals')
        .select(
          'id,title,stage,value_cents,currency,probability,contact_id,product_ids,expected_close_date,won,notes,created_at',
        )
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Deal[];
    },
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    if (!deals) return [];
    if (!search) return deals;
    const q = search.toLowerCase();
    return deals.filter((d) => d.title.toLowerCase().includes(q) || d.id.includes(q));
  }, [deals, search]);

  const openDeal = useMemo(
    () => deals?.find((d) => d.id === openDealId) ?? null,
    [deals, openDealId],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          CRM Deals Drilldown
          <Badge variant="outline" className="text-[10px]">
            {deals?.length ?? 0}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche Titel oder ID…"
            className="h-8 text-xs max-w-[260px]"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <Alert>
            <Inbox className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Keine Deals vorhanden. CRM-Pipeline ist leer — Deals werden über die
              Lead-Magnet/Newsletter-Pipeline oder manuell aus crm_contacts erzeugt.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Titel</TableHead>
                  <TableHead className="text-[10px]">Stage</TableHead>
                  <TableHead className="text-[10px] text-right">Wert</TableHead>
                  <TableHead className="text-[10px] text-right">P</TableHead>
                  <TableHead className="text-[10px]">Close</TableHead>
                  <TableHead className="text-[10px] text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const tone = STAGE_TONE[d.stage] ?? 'bg-muted text-muted-foreground';
                  return (
                    <TableRow key={d.id} className="hover:bg-muted/40">
                      <TableCell className="py-1.5">
                        <div className="text-[11px] font-medium truncate max-w-[200px]">
                          {d.title}
                        </div>
                        <div className="text-[9px] font-mono text-muted-foreground">
                          {d.id.slice(0, 8)}…
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge variant="outline" className={`text-[9px] ${tone}`}>
                          {d.stage}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-[11px] tabular-nums">
                        {d.value_cents != null
                          ? `${(d.value_cents / 100).toLocaleString('de-DE')} ${d.currency ?? 'EUR'}`
                          : '—'}
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-[11px]">
                        {d.probability != null ? `${d.probability}%` : '—'}
                      </TableCell>
                      <TableCell className="py-1.5 text-[10px]">
                        {d.expected_close_date ?? '—'}
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => setOpenDealId(d.id)}
                        >
                          Drilldown <ArrowRight className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DealDrawer
          deal={openDeal}
          open={!!openDealId}
          onClose={() => setOpenDealId(null)}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

function DealDrawer({
  deal,
  open,
  onClose,
}: {
  deal: Deal | null;
  open: boolean;
  onClose: () => void;
}) {
  const dealId = deal?.id;
  const productIds = deal?.product_ids ?? [];
  const contactId = deal?.contact_id ?? null;

  // Contact
  const { data: contact } = useQuery({
    enabled: !!contactId,
    queryKey: ['crm-contact', contactId],
    queryFn: async () => {
      if (!contactId) return null;
      const { data, error } = await (supabase as any)
        .from('crm_contacts')
        .select('id,email,first_name,last_name,lifecycle_stage,company,phone,created_at')
        .eq('id', contactId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Activities (deal_id)
  const { data: activities } = useQuery({
    enabled: !!dealId,
    queryKey: ['crm-deal-activities', dealId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('crm_activities')
        .select('id,activity_type,subject,body,performed_at,performed_by')
        .eq('deal_id', dealId)
        .order('performed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Orders matched to product_ids (license_package_id in order_items)
  const { data: orders } = useQuery({
    enabled: !!dealId && productIds.length > 0,
    queryKey: ['crm-deal-orders', dealId, productIds.join(',')],
    queryFn: async () => {
      // First: order_items where license_package_id matches
      const { data: items, error: itemsErr } = await (supabase as any)
        .from('order_items')
        .select('id,order_id,license_package_id,unit_price_cents,quantity')
        .in('license_package_id', productIds);
      if (itemsErr) throw itemsErr;

      const orderIds = Array.from(new Set((items ?? []).map((i: any) => i.order_id))).filter(
        Boolean,
      );
      if (orderIds.length === 0) return { items: items ?? [], orders: [] };

      const { data: ord, error: ordErr } = await (supabase as any)
        .from('orders')
        .select('id,status,total_cents,currency,created_at,billing_email,billing_name')
        .in('id', orderIds)
        .order('created_at', { ascending: false });
      if (ordErr) throw ordErr;

      return { items: items ?? [], orders: (ord ?? []) as any[] };
    },
  });

  // Email sequences matched by audience ↔ lifecycle_stage
  const audience = contact?.lifecycle_stage ?? null;
  const { data: sequences } = useQuery({
    enabled: open,
    queryKey: ['crm-deal-email-sequences', audience],
    queryFn: async () => {
      // email_sequences has columns: sequence_type, audience, step_number, subject, body_md
      let q = (supabase as any)
        .from('email_sequences')
        .select('id,sequence_type,audience,step_number,subject,created_at')
        .order('audience')
        .order('step_number');
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const sequencesForAudience = useMemo(() => {
    if (!sequences) return [];
    if (!audience) return sequences;
    return sequences.filter(
      (s) => !s.audience || s.audience === audience || s.audience === 'all',
    );
  }, [sequences, audience]);

  if (!deal) return null;

  const noContact = !contactId;
  const noActivity = (activities?.length ?? 0) === 0;
  const noOrders = (orders?.orders.length ?? 0) === 0;
  const noSequences = (sequencesForAudience?.length ?? 0) === 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {deal.title}
          </SheetTitle>
          <SheetDescription className="text-xs">
            <span className="font-mono">{deal.id}</span> · stage{' '}
            <Badge variant="outline" className="text-[9px] mx-1">
              {deal.stage}
            </Badge>
            ·{' '}
            {deal.value_cents != null
              ? `${(deal.value_cents / 100).toLocaleString('de-DE')} ${deal.currency ?? 'EUR'}`
              : '—'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {/* Kontakt */}
          <Section title="Kontakt" icon={<Users className="h-3.5 w-3.5" />}>
            {noContact ? (
              <GapAlert
                title="Kein Kontakt verknüpft"
                detail="Deal ohne contact_id — Lead-Attribution unmöglich."
                ctaLabel="In CRM Contacts öffnen"
                ctaHref="/admin/command/growth?tab=marketing-intel"
              />
            ) : !contact ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <div className="rounded-md border bg-muted/30 p-2.5 text-[11px] space-y-0.5">
                <div className="font-medium">
                  {contact.first_name} {contact.last_name}
                </div>
                <div className="font-mono text-muted-foreground">{contact.email}</div>
                {contact.company && (
                  <div className="text-muted-foreground">{contact.company}</div>
                )}
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="outline" className="text-[9px]">
                    {contact.lifecycle_stage ?? 'unbekannt'}
                  </Badge>
                </div>
              </div>
            )}
          </Section>

          {/* Orders */}
          <Section title="Orders" icon={<ShoppingCart className="h-3.5 w-3.5" />}>
            {productIds.length === 0 ? (
              <GapAlert
                title="Keine Produkte verknüpft"
                detail="product_ids = [] — keine Order-Zuordnung möglich. Deal mit Lizenz-Paket verknüpfen."
                ctaLabel="Pricing prüfen"
                ctaHref="/admin/command/growth?tab=pricing"
              />
            ) : noOrders ? (
              <GapAlert
                title={`Keine Orders für ${productIds.length} Produkte`}
                detail="Deal verweist auf Pakete, aber es existieren noch keine bezahlten Orders. Stripe-Checkout testen oder Pipeline-Stage anpassen."
                ctaLabel="Stripe Checkout testen"
                ctaHref="/admin/command/growth?tab=pricing"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-6 text-[9px]">Order</TableHead>
                    <TableHead className="h-6 text-[9px]">Status</TableHead>
                    <TableHead className="h-6 text-[9px] text-right">Total</TableHead>
                    <TableHead className="h-6 text-[9px]">Datum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders!.orders.map((o: any) => (
                    <TableRow key={o.id}>
                      <TableCell className="py-1 text-[10px] font-mono">
                        {o.id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="py-1">
                        <Badge variant="outline" className="text-[9px]">
                          {o.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-1 text-[10px] text-right tabular-nums">
                        {(o.total_cents / 100).toLocaleString('de-DE')} {o.currency}
                      </TableCell>
                      <TableCell className="py-1 text-[10px]">
                        {new Date(o.created_at).toLocaleDateString('de-DE')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          {/* Activities */}
          <Section title="Aktivitäten" icon={<Activity className="h-3.5 w-3.5" />}>
            {noActivity ? (
              <GapAlert
                title="Keine Aktivitäten"
                detail="Deal ohne crm_activities — Sales-Touchpoints fehlen vollständig. Mindestens 1 Outreach-Activity protokollieren."
                ctaLabel="CRM Settings"
                ctaHref="/admin/command/growth?tab=marketing-intel"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-6 text-[9px]">Typ</TableHead>
                    <TableHead className="h-6 text-[9px]">Subject</TableHead>
                    <TableHead className="h-6 text-[9px]">Wann</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activities!.map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="py-1">
                        <Badge variant="outline" className="text-[9px]">
                          {a.activity_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-1 text-[10px] truncate max-w-[260px]">
                        {a.subject ?? '—'}
                      </TableCell>
                      <TableCell className="py-1 text-[10px]">
                        {new Date(a.performed_at).toLocaleString('de-DE')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          {/* Email Sequences */}
          <Section title="Email-Sequenz-Schritte" icon={<Mail className="h-3.5 w-3.5" />}>
            {noSequences ? (
              <GapAlert
                title={
                  audience
                    ? `Keine Sequence für audience="${audience}"`
                    : 'Keine relevanten Email-Sequences'
                }
                detail="Lifecycle-Stage des Kontakts hat keine passende Email-Sequenz. Welcome-/Nurture-Sequence anlegen oder audience-Mapping korrigieren."
                ctaLabel="Email Sequences"
                ctaHref="/admin/command/growth?tab=growth"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-6 text-[9px]">#</TableHead>
                    <TableHead className="h-6 text-[9px]">Typ</TableHead>
                    <TableHead className="h-6 text-[9px]">Audience</TableHead>
                    <TableHead className="h-6 text-[9px]">Subject</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sequencesForAudience.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="py-1 text-[10px] tabular-nums">
                        {s.step_number}
                      </TableCell>
                      <TableCell className="py-1 text-[10px] font-mono">
                        {s.sequence_type}
                      </TableCell>
                      <TableCell className="py-1 text-[10px]">{s.audience}</TableCell>
                      <TableCell className="py-1 text-[10px] truncate max-w-[260px]">
                        {s.subject}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold mb-1.5 uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function GapAlert({
  title,
  detail,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  detail: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[11px]">{title}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{detail}</div>
        </div>
        <Button asChild size="sm" variant="outline" className="h-6 text-[10px] gap-1 shrink-0">
          <a href={ctaHref}>
            {ctaLabel} <ArrowRight className="h-3 w-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}
