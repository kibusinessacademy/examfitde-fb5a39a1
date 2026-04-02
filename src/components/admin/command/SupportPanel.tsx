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
  HeadphonesIcon, AlertTriangle, Loader2, CheckCircle2, XCircle,
  Clock, MessageSquare, ChevronDown, ArrowRight, RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* ── Types ── */
interface SupportTicket {
  id: string;
  user_id: string | null;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  assigned_to: string | null;
  description: string | null;
}

const priorityTone: Record<string, string> = {
  critical: 'border-destructive/40 text-destructive bg-destructive/5',
  high: 'border-destructive/40 text-destructive bg-destructive/5',
  medium: 'border-warning/40 text-warning bg-warning/5',
  low: 'border-border text-muted-foreground',
};

const statusLabels: Record<string, string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  waiting: 'Wartet',
  resolved: 'Gelöst',
  closed: 'Geschlossen',
};

const statusTone: Record<string, string> = {
  open: 'border-primary/40 text-primary bg-primary/5',
  in_progress: 'border-warning/40 text-warning bg-warning/5',
  waiting: 'border-muted-foreground/40 text-muted-foreground bg-muted/30',
  resolved: 'border-success/40 text-success bg-success/5',
  closed: 'border-border text-muted-foreground',
};

/* ── Hooks ── */
function useSupportTickets() {
  return useQuery({
    queryKey: ['support-tickets'],
    queryFn: async () => {
      // Try to fetch from support_tickets table, fallback gracefully
      try {
        const { data, error } = await supabase
          .from('support_tickets' as any)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) return [];
        return (data || []) as unknown as SupportTicket[];
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });
}

function useAdminNotifications() {
  return useQuery({
    queryKey: ['support-admin-notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('id, title, body, severity, category, is_read, created_at, entity_type, entity_id')
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return [];
      return data || [];
    },
    staleTime: 30_000,
  });
}

/* ── Ticket Detail Sheet ── */
function TicketDetailSheet({ ticket, open, onOpenChange }: { ticket: SupportTicket | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status, updated_at: new Date().toISOString() };
      if (status === 'resolved') updates.resolved_at = new Date().toISOString();
      const { error } = await supabase
        .from('support_tickets' as any)
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support-tickets'] });
      toast.success('Status aktualisiert');
    },
    onError: () => toast.error('Fehler'),
  });

  if (!ticket) return null;

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Ticket {ticket.id.slice(0, 8)}
          </SheetTitle>
          <SheetDescription>{ticket.subject}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusTone[ticket.status] || '')}>
              {statusLabels[ticket.status] || ticket.status}
            </Badge>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", priorityTone[ticket.priority] || '')}>
              {ticket.priority}
            </Badge>
          </div>

          {ticket.description && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Beschreibung</div>
              <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2 whitespace-pre-wrap">{ticket.description}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {ticket.category && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Kategorie</div>
                <div className="text-xs text-foreground">{ticket.category}</div>
              </div>
            )}
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase">Erstellt</div>
              <div className="text-xs text-foreground">{new Date(ticket.created_at).toLocaleString('de-DE')}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-border pt-3 space-y-2">
            <div className="text-xs font-semibold text-foreground">Aktionen</div>
            {ticket.status === 'open' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => updateStatus.mutate({ id: ticket.id, status: 'in_progress' })}
                disabled={updateStatus.isPending}
              >
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                In Bearbeitung nehmen
              </Button>
            )}
            {(ticket.status === 'open' || ticket.status === 'in_progress' || ticket.status === 'waiting') && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => updateStatus.mutate({ id: ticket.id, status: 'resolved' })}
                disabled={updateStatus.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Als gelöst markieren
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Component ── */
export default function SupportPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: tickets = [], isLoading: ticketsLoading } = useSupportTickets();
  const { data: notifications = [], isLoading: notifLoading } = useAdminNotifications();
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [ticketSheetOpen, setTicketSheetOpen] = useState(false);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support-admin-notifications'] });
      toast.success('Gelesen');
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = notifications.map((n: any) => n.id);
      if (ids.length === 0) return;
      const { error } = await supabase
        .from('admin_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support-admin-notifications'] });
      toast.success('Alle als gelesen markiert');
    },
  });

  const isLoading = ticketsLoading || notifLoading;

  const openTickets = tickets.filter(t => t.status === 'open');
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress');
  const criticalTickets = tickets.filter(t => t.priority === 'critical' || t.priority === 'high');
  const criticalNotifications = notifications.filter((n: any) => n.severity === 'critical' || n.severity === 'high');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HeadphonesIcon className="h-5 w-5 text-primary" />
            Support & Benachrichtigungen
          </SheetTitle>
          <SheetDescription>Tickets, System-Alerts & Benachrichtigungen</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-2">
              <div className={cn("rounded-lg border p-2 text-center", openTickets.length > 0 ? "border-warning/30 bg-warning/5" : "border-border")}>
                <div className="text-lg font-bold text-foreground">{openTickets.length}</div>
                <div className="text-[10px] text-muted-foreground">Offen</div>
              </div>
              <div className="rounded-lg border border-border p-2 text-center">
                <div className="text-lg font-bold text-foreground">{inProgressTickets.length}</div>
                <div className="text-[10px] text-muted-foreground">In Arbeit</div>
              </div>
              <div className={cn("rounded-lg border p-2 text-center", notifications.length > 0 ? "border-primary/30 bg-primary/5" : "border-border")}>
                <div className="text-lg font-bold text-foreground">{notifications.length}</div>
                <div className="text-[10px] text-muted-foreground">Ungelesen</div>
              </div>
            </div>

            {/* Critical alerts */}
            {criticalTickets.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-xs font-semibold text-foreground">{criticalTickets.length} kritische/hohe Tickets</span>
                </div>
                <div className="space-y-1">
                  {criticalTickets.slice(0, 5).map(t => (
                    <Button
                      key={t.id}
                      size="sm"
                      variant="outline"
                      className="w-full justify-between h-7 text-[10px]"
                      onClick={() => { setSelectedTicket(t); setTicketSheetOpen(true); }}
                    >
                      <span className="truncate">{t.subject}</span>
                      <Badge variant="outline" className={cn("text-[9px] px-1 py-0", priorityTone[t.priority])}>{t.priority}</Badge>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Admin Notifications */}
            {notifications.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-foreground">System-Benachrichtigungen</div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px]"
                    onClick={() => markAllRead.mutate()}
                    disabled={markAllRead.isPending}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Alle gelesen
                  </Button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {notifications.slice(0, 15).map((n: any) => {
                    const sevCls: Record<string, string> = {
                      critical: 'border-destructive/30 bg-destructive/5',
                      high: 'border-destructive/30 bg-destructive/5',
                      medium: 'border-warning/30 bg-warning/5',
                      low: 'border-border bg-card',
                      info: 'border-border bg-card',
                    };
                    return (
                      <div
                        key={n.id}
                        className={cn("rounded-lg border p-2 cursor-pointer hover:opacity-80 transition-opacity", sevCls[n.severity] || 'border-border')}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        <div className="text-[11px] font-medium text-foreground">{n.title}</div>
                        {n.body && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>}
                        <div className="text-[9px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString('de-DE')}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Open Tickets */}
            <div>
              <div className="text-xs font-semibold text-foreground mb-2">Support-Tickets</div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {tickets.filter(t => t.status !== 'closed').slice(0, 20).map(t => (
                  <div
                    key={t.id}
                    className="rounded-lg border border-border p-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => { setSelectedTicket(t); setTicketSheetOpen(true); }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">{t.subject}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {t.category || 'Allgemein'} · {new Date(t.created_at).toLocaleDateString('de-DE')}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className={cn("text-[9px] px-1 py-0", priorityTone[t.priority] || '')}>
                        {t.priority}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[9px] px-1 py-0", statusTone[t.status] || '')}>
                        {statusLabels[t.status] || t.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {tickets.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">Keine Tickets vorhanden</div>
                )}
              </div>
            </div>
          </div>
        )}

        <TicketDetailSheet ticket={selectedTicket} open={ticketSheetOpen} onOpenChange={setTicketSheetOpen} />
      </SheetContent>
    </Sheet>
  );
}
