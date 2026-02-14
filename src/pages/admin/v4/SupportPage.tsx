import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Headphones, MessageSquare, BookOpen, Search, Plus, Edit, Trash2,
  AlertCircle, Clock, CheckCircle, Eye, EyeOff, ThumbsUp, Filter,
  HeartCrack, AlertTriangle, HelpCircle, Lightbulb, CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useSupportTickets, useSupportTicketMutations,
  useSupportFAQ, useSupportFAQMutations,
  type SupportTicket, type SupportFAQ,
} from '@/hooks/useSupport';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const TICKET_TYPE_ICONS: Record<string, React.ElementType> = {
  verstaendnisfrage: HelpCircle,
  technisch: AlertTriangle,
  pruefungsangst: HeartCrack,
  lernstrategie: Lightbulb,
  abrechnung: CreditCard,
  general: HelpCircle,
};

const SENTIMENT_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  anxious: { label: '😟 Ängstlich', variant: 'destructive' },
  frustrated: { label: '😤 Frustriert', variant: 'destructive' },
  overwhelmed: { label: '😵 Überfordert', variant: 'destructive' },
  neutral: { label: 'Neutral', variant: 'outline' },
  positive: { label: '😊 Positiv', variant: 'default' },
};

// ═══════════════════════════════════════════════════════════
// Tickets Tab
// ═══════════════════════════════════════════════════════════
function TicketsTab() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { data: tickets = [], isLoading } = useSupportTickets({ status: statusFilter, search });
  const { updateStatus } = useSupportTicketMutations();

  const openCount = tickets.filter(t => t.status === 'open').length;
  const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
  const anxiousCount = tickets.filter(t => t.sentiment === 'anxious' || t.sentiment === 'frustrated').length;

  const getStatusIcon = (status: string) => {
    if (status === 'open') return <AlertCircle className="h-3.5 w-3.5 text-orange-500" />;
    if (status === 'in_progress') return <Clock className="h-3.5 w-3.5 text-blue-500" />;
    if (status === 'resolved') return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
    return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const getPriorityVariant = (p: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (p === 'urgent' || p === 'high') return 'destructive';
    if (p === 'medium') return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card className="border-orange-500/30"><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Offen</p>
          <p className="text-2xl font-bold text-orange-500">{openCount}</p>
        </CardContent></Card>
        <Card className="border-blue-500/30"><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">In Bearbeitung</p>
          <p className="text-2xl font-bold text-blue-500">{inProgressCount}</p>
        </CardContent></Card>
        <Card className="border-pink-500/30"><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Emotional kritisch</p>
          <p className="text-2xl font-bold text-pink-500">{anxiousCount}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gesamt</p>
          <p className="text-2xl font-bold">{tickets.length}</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Ticket suchen…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <Filter className="h-3.5 w-3.5 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="open">Offen</SelectItem>
            <SelectItem value="in_progress">In Bearbeitung</SelectItem>
            <SelectItem value="waiting">Wartend</SelectItem>
            <SelectItem value="resolved">Gelöst</SelectItem>
            <SelectItem value="closed">Geschlossen</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Typ</th>
                <th className="text-left py-3 px-4">Betreff</th>
                <th className="text-left py-3 px-4">Stimmung</th>
                <th className="text-left py-3 px-4">Priorität</th>
                <th className="text-left py-3 px-4">Erstellt</th>
                <th className="text-right py-3 px-4">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Keine Tickets gefunden</td></tr>
              ) : tickets.map(ticket => {
                const TypeIcon = TICKET_TYPE_ICONS[ticket.ticket_type || 'general'] || HelpCircle;
                const sentimentInfo = SENTIMENT_LABELS[ticket.sentiment || 'neutral'] || SENTIMENT_LABELS.neutral;
                return (
                  <tr key={ticket.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(ticket.status)}
                        <span className="text-xs capitalize">{ticket.status?.replace('_', ' ')}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1">
                        <TypeIcon className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] capitalize">{(ticket.ticket_type || 'general').replace('_', ' ')}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-xs max-w-[200px] truncate">{ticket.subject}</td>
                    <td className="py-2.5 px-4">
                      <Badge variant={sentimentInfo.variant} className="text-[10px]">{sentimentInfo.label}</Badge>
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge variant={getPriorityVariant(ticket.priority || 'low')} className="text-[10px] capitalize">{ticket.priority}</Badge>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-muted-foreground">
                      {format(new Date(ticket.created_at), 'dd.MM.yy HH:mm', { locale: de })}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <Select value={ticket.status} onValueChange={v => updateStatus.mutate({ id: ticket.id, status: v })}>
                        <SelectTrigger className="w-28 h-7 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Offen</SelectItem>
                          <SelectItem value="in_progress">In Bearbeitung</SelectItem>
                          <SelectItem value="waiting">Wartend</SelectItem>
                          <SelectItem value="resolved">Gelöst</SelectItem>
                          <SelectItem value="closed">Geschlossen</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FAQ Tab
// ═══════════════════════════════════════════════════════════
function FAQTab() {
  const { data: faqs = [], isLoading } = useSupportFAQ();
  const { create, update, remove, togglePublish } = useSupportFAQMutations();
  const [editing, setEditing] = useState<Partial<SupportFAQ> | null>(null);

  const published = faqs.filter(f => f.is_published).length;
  const autoGen = faqs.filter(f => f.auto_generated).length;

  const handleSave = () => {
    if (!editing) return;
    if (editing.id) {
      update.mutate(editing as SupportFAQ & { id: string });
    } else {
      create.mutate(editing);
    }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => setEditing({ question: '', answer: '', ticket_type: 'general', is_published: false })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Neue FAQ
        </Button>
        <Badge variant="outline" className="text-xs">{published} veröffentlicht</Badge>
        <Badge variant="outline" className="text-xs">{autoGen} KI-generiert</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Frage</th>
                <th className="text-left py-3 px-4">Typ</th>
                <th className="text-left py-3 px-4">Nutzung</th>
                <th className="text-left py-3 px-4">Hilfreich</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-right py-3 px-4">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : faqs.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Keine FAQs</td></tr>
              ) : faqs.map(faq => (
                <tr key={faq.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-4 text-xs font-medium max-w-[250px] truncate">{faq.question}</td>
                  <td className="py-2.5 px-4"><Badge variant="outline" className="text-[10px] capitalize">{faq.ticket_type || 'general'}</Badge></td>
                  <td className="py-2.5 px-4 text-xs">{faq.usage_count}×</td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3 text-emerald-500" />
                      <span className="text-xs">{faq.helpful_count}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <Button
                      size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
                      onClick={() => togglePublish.mutate({ id: faq.id, published: !faq.is_published })}
                    >
                      {faq.is_published
                        ? <><Eye className="h-3 w-3 text-emerald-500" /> Live</>
                        : <><EyeOff className="h-3 w-3 text-muted-foreground" /> Entwurf</>}
                    </Button>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(faq)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove.mutate(faq.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing?.id ? 'FAQ bearbeiten' : 'Neue FAQ'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Frage</label>
                <Input value={editing.question || ''} onChange={e => setEditing({ ...editing, question: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Antwort</label>
                <Textarea value={editing.answer || ''} onChange={e => setEditing({ ...editing, answer: e.target.value })} rows={5} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Ticket-Typ</label>
                  <Select value={editing.ticket_type || 'general'} onValueChange={v => setEditing({ ...editing, ticket_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">Allgemein</SelectItem>
                      <SelectItem value="verstaendnisfrage">Verständnisfrage</SelectItem>
                      <SelectItem value="technisch">Technisch</SelectItem>
                      <SelectItem value="pruefungsangst">Prüfungsangst</SelectItem>
                      <SelectItem value="lernstrategie">Lernstrategie</SelectItem>
                      <SelectItem value="abrechnung">Abrechnung</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Zielgruppe</label>
                  <Select value={editing.target_audience || 'alle'} onValueChange={v => setEditing({ ...editing, target_audience: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alle">Alle</SelectItem>
                      <SelectItem value="azubi">Auszubildende</SelectItem>
                      <SelectItem value="betrieb">Betriebe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button onClick={handleSave}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Support Page
// ═══════════════════════════════════════════════════════════
export default function SupportPage() {
  const location = useLocation();
  const subPath = location.pathname.replace('/admin/support', '').replace(/^\//, '');

  const tabs = [
    { path: '/admin/support', label: 'Tickets', icon: MessageSquare, key: '' },
    { path: '/admin/support/faq', label: 'FAQ-Verwaltung', icon: BookOpen, key: 'faq' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Support</h1>
        <p className="text-sm text-muted-foreground mt-1">Ticket-Inbox · Sentiment-Erkennung · FAQ-Knüpfung</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = subPath === tab.key;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px",
                isActive
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {tab.label}
            </Link>
          );
        })}
      </div>

      {subPath === '' && <TicketsTab />}
      {subPath === 'faq' && <FAQTab />}
    </div>
  );
}
