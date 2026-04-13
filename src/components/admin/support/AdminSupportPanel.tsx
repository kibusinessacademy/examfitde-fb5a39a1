import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AdminSheet as Sheet, AdminSheetContent as SheetContent,
  AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle,
  AdminSheetDescription as SheetDescription,
} from '@/components/admin/AdminSheet';
import {
  AlertCircle, Clock, CheckCircle2, XCircle, Search, Filter,
  MessageSquare, ArrowRight, ExternalLink, Bug, Lightbulb,
  CreditCard, Users, FileText, HelpCircle, Wrench, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';

/* ── Types (matching user_tickets DB schema) ── */
type TicketStatus = 'OPEN' | 'TRIAGE' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED' | 'DUPLICATE';
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type TicketType = 'CONTENT_ISSUE' | 'FEATURE_REQUEST' | 'BILLING_QUESTION' | 'LICENSE_QUESTION' | 'LEARNER_ACCOUNT_ISSUE' | 'DATA_CORRECTION' | 'TECHNICAL_ISSUE';

interface UserTicket {
  id: string;
  created_by: string;
  title: string;
  message: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  source: string;
  page_path: string | null;
  certification_id: string | null;
  lesson_id: string | null;
  question_id: string | null;
  admin_notes: string | null;
  assigned_to: string | null;
  attachment_urls: string[];
  created_at: string;
  updated_at: string;
}

/* ── Constants ── */
const STATUS_CONFIG: Record<TicketStatus, { label: string; icon: typeof AlertCircle; tone: string }> = {
  OPEN: { label: 'Offen', icon: AlertCircle, tone: 'border-warning/40 text-warning bg-warning/5' },
  TRIAGE: { label: 'Triage', icon: AlertTriangle, tone: 'border-primary/40 text-primary bg-primary/5' },
  IN_PROGRESS: { label: 'In Bearbeitung', icon: Clock, tone: 'border-primary/40 text-primary bg-primary/5' },
  RESOLVED: { label: 'Gelöst', icon: CheckCircle2, tone: 'border-success/40 text-success bg-success/5' },
  REJECTED: { label: 'Abgelehnt', icon: XCircle, tone: 'border-destructive/40 text-destructive bg-destructive/5' },
  DUPLICATE: { label: 'Duplikat', icon: XCircle, tone: 'border-muted-foreground/40 text-muted-foreground bg-muted/30' },
};

const PRIORITY_TONE: Record<TicketPriority, string> = {
  CRITICAL: 'border-destructive/40 text-destructive bg-destructive/5',
  HIGH: 'border-destructive/30 text-destructive bg-destructive/5',
  MEDIUM: 'border-warning/30 text-warning bg-warning/5',
  LOW: 'border-border text-muted-foreground',
};

const TYPE_CONFIG: Record<TicketType, { label: string; icon: typeof Bug }> = {
  CONTENT_ISSUE: { label: 'Inhaltsfehler', icon: Bug },
  FEATURE_REQUEST: { label: 'Feature-Wunsch', icon: Lightbulb },
  BILLING_QUESTION: { label: 'Abrechnung', icon: CreditCard },
  LICENSE_QUESTION: { label: 'Lizenzfrage', icon: FileText },
  LEARNER_ACCOUNT_ISSUE: { label: 'Account', icon: Users },
  DATA_CORRECTION: { label: 'Datenkorrektur', icon: Wrench },
  TECHNICAL_ISSUE: { label: 'Technik', icon: HelpCircle },
};

const ALL_STATUSES: TicketStatus[] = ['OPEN', 'TRIAGE', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'DUPLICATE'];

/* ── Hook ── */
function useUserTickets(opts?: { status?: string; search?: string }) {
  return useQuery({
    queryKey: ['admin-user-tickets', opts?.status, opts?.search],
    queryFn: async () => {
      let query = supabase
        .from('user_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (opts?.status && opts.status !== 'all') {
        query = query.eq('status', opts.status);
      }
      if (opts?.search) {
        query = query.ilike('title', `%${opts.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as UserTicket[];
    },
    staleTime: 15_000,
  });
}

/* ── Ticket Detail Sheet ── */
function TicketDetailSheet({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: UserTicket | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TicketStatus }) => {
      const { error } = await supabase
        .from('user_tickets')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user-tickets'] });
      toast.success('Status aktualisiert');
    },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });

  const saveNotes = useMutation({
    mutationFn: async ({ id, admin_notes }: { id: string; admin_notes: string }) => {
      const { error } = await supabase
        .from('user_tickets')
        .update({ admin_notes, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user-tickets'] });
      toast.success('Notiz gespeichert');
    },
  });

  const updatePriority = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: TicketPriority }) => {
      const { error } = await supabase
        .from('user_tickets')
        .update({ priority, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user-tickets'] });
      toast.success('Priorität aktualisiert');
    },
  });

  if (!ticket) return null;

  const statusCfg = STATUS_CONFIG[ticket.status];
  const typeCfg = TYPE_CONFIG[ticket.type];
  const StatusIcon = statusCfg.icon;
  const TypeIcon = typeCfg.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <span className="truncate">{ticket.title}</span>
          </SheetTitle>
          <SheetDescription>
            Ticket {ticket.id.slice(0, 8)} · {format(new Date(ticket.created_at), 'dd.MM.yy HH:mm', { locale: de })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 mt-4">
          {/* Status + Priority + Type badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', statusCfg.tone)}>
              <StatusIcon className="h-3 w-3 mr-1" />{statusCfg.label}
            </Badge>
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', PRIORITY_TONE[ticket.priority])}>
              {ticket.priority}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              <TypeIcon className="h-3 w-3 mr-1" />{typeCfg.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{ticket.source}</Badge>
          </div>

          {/* Message */}
          <div>
            <div className="text-xs font-medium text-foreground mb-1">Nachricht</div>
            <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {ticket.message}
            </div>
          </div>

          {/* Context links */}
          <div className="grid grid-cols-2 gap-2">
            {ticket.page_path && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Seite</div>
                <div className="text-xs text-foreground truncate flex items-center gap-1">
                  <ExternalLink className="h-3 w-3 shrink-0" />{ticket.page_path}
                </div>
              </div>
            )}
            {ticket.certification_id && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Zertifizierung</div>
                <div className="text-xs text-foreground font-mono">{ticket.certification_id.slice(0, 8)}</div>
              </div>
            )}
            {ticket.lesson_id && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Lektion</div>
                <div className="text-xs text-foreground font-mono">{ticket.lesson_id.slice(0, 8)}</div>
              </div>
            )}
            {ticket.question_id && (
              <div className="rounded-lg border border-border p-2">
                <div className="text-[9px] text-muted-foreground uppercase">Frage</div>
                <div className="text-xs text-foreground font-mono">{ticket.question_id.slice(0, 8)}</div>
              </div>
            )}
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase">Ersteller</div>
              <div className="text-xs text-foreground font-mono">{ticket.created_by.slice(0, 8)}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase">Aktualisiert</div>
              <div className="text-xs text-foreground">{format(new Date(ticket.updated_at), 'dd.MM.yy HH:mm', { locale: de })}</div>
            </div>
          </div>

          {/* Attachments */}
          {ticket.attachment_urls.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Anhänge ({ticket.attachment_urls.length})</div>
              <div className="space-y-1">
                {ticket.attachment_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />{url.split('/').pop()?.slice(0, 40)}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-border pt-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">Aktionen</div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Status ändern</div>
                <Select
                  value={ticket.status}
                  onValueChange={(v) => updateStatus.mutate({ id: ticket.id, status: v as TicketStatus })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Priorität</div>
                <Select
                  value={ticket.priority}
                  onValueChange={(v) => updatePriority.mutate({ id: ticket.id, priority: v as TicketPriority })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex gap-2">
              {ticket.status === 'OPEN' && (
                <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => updateStatus.mutate({ id: ticket.id, status: 'IN_PROGRESS' })} disabled={updateStatus.isPending}>
                  <ArrowRight className="h-3.5 w-3.5 mr-1" />In Bearbeitung
                </Button>
              )}
              {(ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS' || ticket.status === 'TRIAGE') && (
                <Button size="sm" className="flex-1 text-xs" onClick={() => updateStatus.mutate({ id: ticket.id, status: 'RESOLVED' })} disabled={updateStatus.isPending}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Lösen
                </Button>
              )}
            </div>

            {/* Admin Notes */}
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Admin-Notizen</div>
              <Textarea
                className="text-xs min-h-[60px]"
                placeholder="Interne Notizen..."
                defaultValue={ticket.admin_notes ?? ''}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 text-xs"
                onClick={() => saveNotes.mutate({ id: ticket.id, admin_notes: notes || ticket.admin_notes || '' })}
                disabled={saveNotes.isPending}
              >
                Notiz speichern
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Panel ── */
export default function AdminSupportPanel() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<UserTicket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: tickets = [], isLoading } = useUserTickets({ status: statusFilter, search });

  // KPIs
  const openCount = tickets.filter(t => t.status === 'OPEN').length;
  const triageCount = tickets.filter(t => t.status === 'TRIAGE').length;
  const inProgressCount = tickets.filter(t => t.status === 'IN_PROGRESS').length;
  const criticalCount = tickets.filter(t => t.priority === 'CRITICAL' || t.priority === 'HIGH').length;

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className={cn('border-warning/30 bg-warning/5', openCount === 0 && 'border-border bg-card')}>
          <CardContent className="p-4">
            <div className="text-lg font-bold text-foreground">{openCount}</div>
            <div className="text-[11px] text-muted-foreground">Offen</div>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="text-lg font-bold text-foreground">{triageCount}</div>
            <div className="text-[11px] text-muted-foreground">Triage</div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="text-lg font-bold text-foreground">{inProgressCount}</div>
            <div className="text-[11px] text-muted-foreground">In Bearbeitung</div>
          </CardContent>
        </Card>
        <Card className={cn('border-destructive/30 bg-destructive/5', criticalCount === 0 && 'border-border bg-card')}>
          <CardContent className="p-4">
            <div className="text-lg font-bold text-foreground">{criticalCount}</div>
            <div className="text-[11px] text-muted-foreground">Kritisch/Hoch</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Ticket suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <Filter className="h-4 w-4 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            {ALL_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tickets</CardTitle>
          <CardDescription className="text-xs">{tickets.length} Tickets · user_tickets (SSOT)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Titel</TableHead>
                <TableHead>Priorität</TableHead>
                <TableHead className="hidden sm:table-cell">Erstellt</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => {
                const statusCfg = STATUS_CONFIG[ticket.status];
                const typeCfg = TYPE_CONFIG[ticket.type];
                const StatusIcon = statusCfg.icon;
                const TypeIcon = typeCfg.icon;

                return (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => { setSelectedTicket(ticket); setDetailOpen(true); }}
                  >
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', statusCfg.tone)}>
                        <StatusIcon className="h-3 w-3 mr-1" />{statusCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <TypeIcon className="h-3.5 w-3.5" />{typeCfg.label}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-foreground truncate max-w-[250px]">{ticket.title}</div>
                      {ticket.page_path && (
                        <div className="text-[10px] text-muted-foreground truncate max-w-[250px]">{ticket.page_path}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', PRIORITY_TONE[ticket.priority])}>
                        {ticket.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {format(new Date(ticket.created_at), 'dd.MM.yy HH:mm', { locale: de })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={(e) => { e.stopPropagation(); setSelectedTicket(ticket); setDetailOpen(true); }}>
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {tickets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {search || statusFilter !== 'all' ? 'Keine Tickets gefunden' : 'Keine Tickets vorhanden'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <TicketDetailSheet ticket={selectedTicket} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
