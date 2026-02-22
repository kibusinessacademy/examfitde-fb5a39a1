import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  HelpCircle, AlertTriangle, CreditCard, Users, FileEdit,
  Bug, Lightbulb, ArrowRight, Loader2, CheckCircle, FileText,
  Receipt, User
} from 'lucide-react';
import { toast } from 'sonner';

// ── Ticket type definitions ──
const TICKET_TYPES = [
  { id: 'BILLING_QUESTION', label: 'Rechnung / Zahlung', icon: CreditCard, description: 'Rechnungen, Zahlungen, MwSt', color: 'text-green-500' },
  { id: 'LICENSE_QUESTION', label: 'Lizenz / Seats', icon: Users, description: 'Laufzeit, Upgrade, Zuweisung', color: 'text-blue-500' },
  { id: 'LEARNER_ACCOUNT_ISSUE', label: 'Learner-Account', icon: User, description: 'Login, Zuordnung, Zugang', color: 'text-purple-500' },
  { id: 'DATA_CORRECTION', label: 'Daten korrigieren', icon: FileEdit, description: 'Firma, Adresse, USt-IdNr', color: 'text-orange-500' },
  { id: 'TECHNICAL_ISSUE', label: 'Technisches Problem', icon: Bug, description: 'Bug, Fehler, Performance', color: 'text-red-500' },
  { id: 'CONTENT_ISSUE', label: 'Inhalt melden', icon: AlertTriangle, description: 'Falsch, unklar, veraltet', color: 'text-yellow-500' },
  { id: 'FEATURE_REQUEST', label: 'Feature vorschlagen', icon: Lightbulb, description: 'Neue Funktion, Verbesserung', color: 'text-cyan-500' },
] as const;

type TicketContext = {
  profile: { full_name: string; company_id: string | null } | null;
  company: { id: string; name: string } | null;
  orders: { id: string; created_at: string; status: string; total_cents: number; currency: string; billing_name: string; billing_company: string }[];
  invoices: { id: string; order_id: string; invoice_number: string; issue_date: string; status: string; total_gross_cents: number }[];
  payments: { id: string; order_id: string; amount_cents: number; currency: string; payment_status: string; paid_at: string }[];
  managed_learners: { user_id: string; full_name: string; login_username: string; personnel_number: string }[];
  certifications: { course_id: string; title: string; certification_id: string }[];
  templates: Record<string, { id: string; label: string; default_priority: string }[]>;
};

type TicketLink = {
  entity_type: string;
  entity_id: string;
  label: string | null;
  meta: Record<string, unknown>;
};

interface SmartTicketCreateProps {
  onCreated?: () => void;
  preselectedType?: string;
  contextCourseId?: string;
  contextLessonId?: string;
  contextQuestionId?: string;
  contextBlueprintId?: string;
}

export default function SmartTicketCreate({
  onCreated,
  preselectedType,
  contextCourseId,
  contextLessonId,
  contextQuestionId,
  contextBlueprintId,
}: SmartTicketCreateProps) {
  const { user } = useAuth();
  const [selectedType, setSelectedType] = useState<string | null>(preselectedType ?? null);
  const [subCategory, setSubCategory] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // Context data from edge function
  const [context, setContext] = useState<TicketContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Selected linked entities
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Load context when component mounts
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;

    (async () => {
      setContextLoading(true);
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session?.session?.access_token;
        if (!token) return;

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-ticket-context`,
          { headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
        );
        if (res.ok && alive) {
          setContext(await res.json());
        }
      } catch {
        // silent - context is optional
      } finally {
        if (alive) setContextLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [user?.id]);

  // Templates for selected type
  const templates = useMemo(() => {
    if (!selectedType || !context?.templates) return [];
    const t = context.templates;
    return Array.isArray(t) ? [] : (t[selectedType] ?? []);
  }, [selectedType, context?.templates]);

  // Show context selectors based on type
  const showInvoiceSelector = ['BILLING_QUESTION'].includes(selectedType ?? '');
  const showLearnerSelector = ['LEARNER_ACCOUNT_ISSUE', 'LICENSE_QUESTION'].includes(selectedType ?? '');
  const showOrderSelector = ['BILLING_QUESTION', 'LICENSE_QUESTION'].includes(selectedType ?? '');

  // Build ticket_links from selections
  function buildLinks(): TicketLink[] {
    const links: TicketLink[] = [];
    if (selectedInvoiceId) {
      const inv = context?.invoices.find(i => i.id === selectedInvoiceId);
      links.push({
        entity_type: 'INVOICE',
        entity_id: selectedInvoiceId,
        label: inv?.invoice_number ?? null,
        meta: { status: inv?.status, total_gross_cents: inv?.total_gross_cents },
      });
    }
    if (selectedOrderId) {
      const ord = context?.orders.find(o => o.id === selectedOrderId);
      links.push({
        entity_type: 'ORDER',
        entity_id: selectedOrderId,
        label: ord?.billing_company ?? ord?.billing_name ?? null,
        meta: { status: ord?.status, total_cents: ord?.total_cents },
      });
    }
    if (selectedLearnerId) {
      const lr = context?.managed_learners.find(l => l.user_id === selectedLearnerId);
      links.push({
        entity_type: 'LEARNER',
        entity_id: selectedLearnerId,
        label: lr?.full_name ?? null,
        meta: { login_username: lr?.login_username },
      });
    }
    if (context?.company) {
      links.push({
        entity_type: 'COMPANY',
        entity_id: context.company.id,
        label: context.company.name,
        meta: {},
      });
    }
    return links;
  }

  async function submit() {
    if (sending || !selectedType || !title.trim() || !message.trim()) return;
    setSending(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const payload: Record<string, unknown> = {
        type: selectedType,
        title: title.trim(),
        message: message.trim(),
        priority: subCategory
          ? templates.find(t => t.id === subCategory)?.default_priority ?? 'MEDIUM'
          : 'MEDIUM',
        sub_category: subCategory,
        page_path: window.location.pathname,
        ticket_links: buildLinks(),
      };

      // Pass content context IDs if available
      if (contextCourseId) payload.certification_id = contextCourseId;
      if (contextLessonId) payload.lesson_id = contextLessonId;
      if (contextQuestionId) payload.question_id = contextQuestionId;
      if (contextBlueprintId) payload.blueprint_id = contextBlueprintId;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-ticket`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'submit failed');

      if (data.duplicate) {
        toast.info('Dieses Ticket wurde bereits eingereicht.');
      } else {
        toast.success('Ticket erstellt! Wir kümmern uns darum.');
      }

      // Reset
      setSelectedType(null);
      setSubCategory(null);
      setTitle('');
      setMessage('');
      setSelectedInvoiceId(null);
      setSelectedLearnerId(null);
      setSelectedOrderId(null);
      onCreated?.();
    } catch {
      toast.error('Fehler beim Erstellen des Tickets.');
    } finally {
      setSending(false);
    }
  }

  const formatCents = (cents: number, currency = 'EUR') =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);

  return (
    <div className="space-y-6">
      {/* Company context */}
      {context?.company && (
        <Card className="glass-card border-primary/20 bg-primary/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Users className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="text-sm text-muted-foreground">
              Firma: <strong className="text-foreground">{context.company.name}</strong>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Choose ticket type */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
          Worum geht es?
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TICKET_TYPES.map((type) => {
            const Icon = type.icon;
            const isSelected = selectedType === type.id;
            return (
              <button
                key={type.id}
                onClick={() => {
                  setSelectedType(type.id);
                  setSubCategory(null);
                  setSelectedInvoiceId(null);
                  setSelectedLearnerId(null);
                  setSelectedOrderId(null);
                }}
                className={`glass-card p-4 rounded-xl text-left transition-all hover:scale-[1.02] ${
                  isSelected ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`h-5 w-5 mt-0.5 ${type.color}`} />
                  <div>
                    <div className="font-medium text-sm">{type.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{type.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Sub-category templates */}
      {selectedType && templates.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Genauer?
          </h3>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSubCategory(subCategory === t.id ? null : t.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                  subCategory === t.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted/50 border-border'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Context selectors */}
      {selectedType && (
        <div className="space-y-4">
          {/* Invoice selector */}
          {showInvoiceSelector && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Betroffene Rechnung</label>
              {contextLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (context?.invoices?.length ?? 0) > 0 ? (
                <Select value={selectedInvoiceId ?? ''} onValueChange={(v) => setSelectedInvoiceId(v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Rechnung auswählen (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {context!.invoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        <div className="flex items-center gap-2">
                          <Receipt className="h-3 w-3" />
                          <span>{inv.invoice_number}</span>
                          <span className="text-muted-foreground">– {inv.issue_date}</span>
                          <span className="text-muted-foreground">({formatCents(inv.total_gross_cents)})</span>
                          <Badge variant="outline" className="text-xs">{inv.status}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">Keine Rechnungen gefunden.</p>
              )}
            </div>
          )}

          {/* Order selector */}
          {showOrderSelector && !showInvoiceSelector && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Betroffene Bestellung</label>
              {contextLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (context?.orders?.length ?? 0) > 0 ? (
                <Select value={selectedOrderId ?? ''} onValueChange={(v) => setSelectedOrderId(v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Bestellung auswählen (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {context!.orders.map((ord) => (
                      <SelectItem key={ord.id} value={ord.id}>
                        <div className="flex items-center gap-2">
                          <FileText className="h-3 w-3" />
                          <span>{ord.billing_company || ord.billing_name}</span>
                          <span className="text-muted-foreground">– {formatCents(ord.total_cents, ord.currency)}</span>
                          <Badge variant="outline" className="text-xs">{ord.status}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">Keine Bestellungen gefunden.</p>
              )}
            </div>
          )}

          {/* Learner selector */}
          {showLearnerSelector && (context?.managed_learners?.length ?? 0) > 0 && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Betroffener Learner</label>
              <Select value={selectedLearnerId ?? ''} onValueChange={(v) => setSelectedLearnerId(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Learner auswählen (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {context!.managed_learners.map((lr) => (
                    <SelectItem key={lr.user_id} value={lr.user_id}>
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        <span>{lr.full_name || lr.login_username}</span>
                        {lr.personnel_number && (
                          <span className="text-muted-foreground">#{lr.personnel_number}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Betreff</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Kurzer Betreff (z.B. 'Rechnung RE-2025-042 fehlt')"
              maxLength={120}
            />
          </div>

          {/* Message */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Beschreibung</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Beschreibe dein Anliegen so genau wie möglich..."
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Linked entities preview */}
          {buildLinks().length > 0 && (
            <div className="flex flex-wrap gap-2">
              {buildLinks().map((link, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {link.entity_type}: {link.label ?? link.entity_id.slice(0, 8)}
                </Badge>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedType(null);
                setSubCategory(null);
                setTitle('');
                setMessage('');
                setSelectedInvoiceId(null);
                setSelectedLearnerId(null);
                setSelectedOrderId(null);
              }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={submit}
              disabled={!title.trim() || title.trim().length < 4 || !message.trim() || message.trim().length < 10 || sending}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Ticket senden
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
