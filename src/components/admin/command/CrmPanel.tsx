import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Users, Building2, TrendingUp, AlertTriangle, Loader2,
  Phone, Mail, Calendar, ArrowRight, ChevronDown,
  CheckCircle2, XCircle, UserPlus, MessageSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* ── Types ── */
interface B2BLead {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  azubi_count: number | null;
  status: string;
  source: string;
  deal_value_eur: number | null;
  next_action: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const statusLabels: Record<string, string> = {
  new: 'Neu',
  contacted: 'Kontaktiert',
  demo_scheduled: 'Demo geplant',
  demo_done: 'Demo erledigt',
  proposal_sent: 'Angebot gesendet',
  negotiation: 'Verhandlung',
  closed_won: 'Gewonnen ✅',
  closed_lost: 'Verloren ❌',
};

const statusTone: Record<string, string> = {
  new: 'border-primary/40 text-primary bg-primary/5',
  contacted: 'border-warning/40 text-warning bg-warning/5',
  demo_scheduled: 'border-warning/40 text-warning bg-warning/5',
  demo_done: 'border-success/40 text-success bg-success/5',
  proposal_sent: 'border-success/40 text-success bg-success/5',
  negotiation: 'border-warning/40 text-warning bg-warning/5',
  closed_won: 'border-success/40 text-success bg-success/5',
  closed_lost: 'border-destructive/40 text-destructive bg-destructive/5',
};

const NEXT_STATUS: Record<string, string> = {
  new: 'contacted',
  contacted: 'demo_scheduled',
  demo_scheduled: 'demo_done',
  demo_done: 'proposal_sent',
  proposal_sent: 'negotiation',
  negotiation: 'closed_won',
};

/* ── Hooks ── */
function useB2BLeads() {
  return useQuery({
    queryKey: ['crm-b2b-leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('b2b_leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return [];
      return (data || []) as unknown as B2BLead[];
    },
    staleTime: 30_000,
  });
}

function useLeadsSummary() {
  return useQuery({
    queryKey: ['crm-leads-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, intent, source, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return { total: 0, purchase: 0, recent7d: 0 };
      const d = data || [];
      const now = Date.now();
      return {
        total: d.length,
        purchase: d.filter((l: any) => l.intent === 'purchase').length,
        recent7d: d.filter((l: any) => now - new Date(l.created_at).getTime() < 7 * 86400000).length,
      };
    },
    staleTime: 60_000,
  });
}

/* ── Lead Detail Sheet ── */
function LeadDetailSheet({ lead, open, onOpenChange }: { lead: B2BLead | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();

  const advanceStatus = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) => {
      const { error } = await supabase
        .from('b2b_leads')
        .update({ status: newStatus, updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-b2b-leads'] });
      toast.success('Status aktualisiert');
    },
    onError: () => toast.error('Fehler'),
  });

  const markLost = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('b2b_leads')
        .update({ status: 'closed_lost', updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-b2b-leads'] });
      toast.success('Als verloren markiert');
      onOpenChange(false);
    },
  });

  if (!lead) return null;
  const nextStatus = NEXT_STATUS[lead.status];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {lead.company_name}
          </SheetTitle>
          <SheetDescription>B2B Lead · {lead.source}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusTone[lead.status] || '')}>
            {statusLabels[lead.status] || lead.status}
          </Badge>

          <div className="grid grid-cols-2 gap-3">
            {lead.contact_name && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Kontakt</div>
                <div className="text-xs font-medium text-foreground">{lead.contact_name}</div>
              </div>
            )}
            {lead.contact_email && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">E-Mail</div>
                <div className="text-xs text-foreground truncate">{lead.contact_email}</div>
              </div>
            )}
            {lead.azubi_count != null && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Azubis</div>
                <div className="text-sm font-bold text-foreground">{lead.azubi_count}</div>
              </div>
            )}
            {lead.deal_value_eur != null && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Deal-Wert</div>
                <div className="text-sm font-bold text-foreground">€{lead.deal_value_eur.toFixed(0)}</div>
              </div>
            )}
          </div>

          {lead.notes && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Notizen</div>
              <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2">{lead.notes}</div>
            </div>
          )}

          {lead.next_action && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
              <div className="text-[10px] text-primary flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                Nächster Schritt: {lead.next_action}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Erstellt: {new Date(lead.created_at).toLocaleString('de-DE')}
          </div>

          {/* Actions */}
          <div className="border-t border-border pt-3 space-y-2">
            <div className="text-xs font-semibold text-foreground">Aktionen</div>
            {nextStatus && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => advanceStatus.mutate({ id: lead.id, newStatus: nextStatus })}
                disabled={advanceStatus.isPending}
              >
                {advanceStatus.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 mr-1.5" />}
                → {statusLabels[nextStatus]}
              </Button>
            )}
            {lead.status !== 'closed_won' && lead.status !== 'closed_lost' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full border-destructive/30 text-destructive"
                onClick={() => markLost.mutate(lead.id)}
                disabled={markLost.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Als verloren markieren
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Component ── */
export default function CrmPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: leads = [], isLoading: leadsLoading } = useB2BLeads();
  const { data: leadsSummary, isLoading: summaryLoading } = useLeadsSummary();
  const [selectedLead, setSelectedLead] = useState<B2BLead | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);

  const isLoading = leadsLoading || summaryLoading;

  const pipeline = leads.filter(l => !['closed_won', 'closed_lost'].includes(l.status));
  const newLeads = leads.filter(l => l.status === 'new');
  const wonLeads = leads.filter(l => l.status === 'closed_won');
  const pipelineValue = pipeline.reduce((s, l) => s + (l.deal_value_eur || 0), 0);
  const wonValue = wonLeads.reduce((s, l) => s + (l.deal_value_eur || 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            CRM & Leads
          </SheetTitle>
          <SheetDescription>B2B Pipeline, Leads & Kundenmanagement</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border p-2 text-center">
                <div className="text-lg font-bold text-foreground">{pipeline.length}</div>
                <div className="text-[10px] text-muted-foreground">In Pipeline</div>
              </div>
              <div className="rounded-lg border border-success/30 bg-success/5 p-2 text-center">
                <div className="text-lg font-bold text-foreground">€{pipelineValue.toFixed(0)}</div>
                <div className="text-[10px] text-muted-foreground">Pipeline-Wert</div>
              </div>
              <div className={cn("rounded-lg border p-2 text-center", newLeads.length > 3 ? "border-warning/30 bg-warning/5" : "border-border")}>
                <div className="text-lg font-bold text-foreground">{newLeads.length}</div>
                <div className="text-[10px] text-muted-foreground">Neue Leads</div>
              </div>
              <div className="rounded-lg border border-border p-2 text-center">
                <div className="text-lg font-bold text-foreground">€{wonValue.toFixed(0)}</div>
                <div className="text-[10px] text-muted-foreground">Gewonnen</div>
              </div>
            </div>

            {/* Consumer leads summary */}
            {leadsSummary && (
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1">
                  <UserPlus className="h-3.5 w-3.5 text-primary" />
                  Consumer Leads
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="text-center">
                    <div className="text-sm font-bold text-foreground">{leadsSummary.total}</div>
                    <div className="text-[9px] text-muted-foreground">Gesamt</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold text-success">{leadsSummary.purchase}</div>
                    <div className="text-[9px] text-muted-foreground">Kauf-Intent</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold text-foreground">{leadsSummary.recent7d}</div>
                    <div className="text-[9px] text-muted-foreground">7 Tage</div>
                  </div>
                </div>
              </div>
            )}

            {/* Alerts */}
            {newLeads.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                <div className="text-[10px] text-foreground">
                  <span className="font-semibold">{newLeads.length} neue Leads</span> warten auf erste Kontaktaufnahme.
                </div>
              </div>
            )}

            {/* Pipeline leads */}
            <div>
              <div className="text-xs font-semibold text-foreground mb-2">B2B Pipeline</div>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {pipeline.map(lead => (
                  <div
                    key={lead.id}
                    className="rounded-lg border border-border p-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => { setSelectedLead(lead); setLeadSheetOpen(true); }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">{lead.company_name}</div>
                      <div className="text-[10px] text-muted-foreground">{lead.contact_name || lead.source}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {lead.deal_value_eur != null && (
                        <span className="text-[10px] font-bold text-foreground">€{lead.deal_value_eur.toFixed(0)}</span>
                      )}
                      <Badge variant="outline" className={cn("text-[9px] px-1 py-0", statusTone[lead.status] || '')}>
                        {statusLabels[lead.status] || lead.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {pipeline.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">Keine aktive Pipeline</div>
                )}
              </div>
            </div>

            {/* Won deals */}
            {wonLeads.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  Gewonnene Deals ({wonLeads.length})
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {wonLeads.slice(0, 10).map(lead => (
                    <div
                      key={lead.id}
                      className="rounded-lg border border-success/20 bg-success/5 p-2 flex items-center justify-between cursor-pointer hover:bg-success/10 transition-colors"
                      onClick={() => { setSelectedLead(lead); setLeadSheetOpen(true); }}
                    >
                      <span className="text-xs font-medium text-foreground">{lead.company_name}</span>
                      <span className="text-xs font-bold text-success">€{(lead.deal_value_eur || 0).toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <LeadDetailSheet lead={selectedLead} open={leadSheetOpen} onOpenChange={setLeadSheetOpen} />
      </SheetContent>
    </Sheet>
  );
}
