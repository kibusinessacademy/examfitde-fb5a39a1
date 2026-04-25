import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidation } from './useAdminRealtimeInvalidation';
import { toast } from 'sonner';

// ═══════════════════════════════════════════════════════════
// Support Tickets (Admin)
// ═══════════════════════════════════════════════════════════

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  description: string | null;
  category: string | null;
  priority: string;
  status: string;
  ticket_type: string | null;
  sentiment: string | null;
  context_course_id: string | null;
  context_url: string | null;
  auto_resolved: boolean | null;
  was_self_resolved: boolean | null;
  feedback_rating: number | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useSupportTickets(opts?: { status?: string; search?: string }) {
  useRealtimeInvalidation('support_tickets', [['admin-support-tickets']]);

  return useQuery({
    queryKey: ['admin-support-tickets', opts?.status, opts?.search],
    queryFn: async () => {
      let query = supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (opts?.status && opts.status !== 'all') {
        query = query.eq('status', opts.status);
      }
      if (opts?.search) {
        query = query.ilike('subject', `%${opts.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as SupportTicket[];
    },
  });
}

export function useSupportTicketMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-support-tickets'] });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: TablesUpdate<'support_tickets'> = {
        status,
        updated_at: new Date().toISOString(),
        ...(status === 'resolved' ? { resolved_at: new Date().toISOString() } : {}),
      };
      const { error } = await updateTable('support_tickets', id, updates);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Status aktualisiert'); },
  });

  const addResolutionNote = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await updateTable('support_tickets', id, {
        resolution_notes: note,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Notiz gespeichert'); },
  });

  return { updateStatus, addResolutionNote };
}

// ═══════════════════════════════════════════════════════════
// Support FAQ (Admin)
// ═══════════════════════════════════════════════════════════

export interface SupportFAQ {
  id: string;
  question: string;
  answer: string;
  ticket_type: string | null;
  learning_phase: string | null;
  target_audience: string | null;
  usage_count: number;
  helpful_count: number;
  is_published: boolean;
  auto_generated: boolean;
  created_at: string;
  updated_at: string;
}

export function useSupportFAQ() {
  useRealtimeInvalidation('support_faq', [['admin-support-faq']]);

  return useQuery({
    queryKey: ['admin-support-faq'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_faq')
        .select('*')
        .order('usage_count', { ascending: false });
      if (error) throw error;
      return (data || []) as SupportFAQ[];
    },
  });
}

export function useSupportFAQMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-support-faq'] });

  const create = useMutation({
    mutationFn: async (faq: Partial<SupportFAQ>) => {
      const { error } = await supabase.from('support_faq').insert(faq as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('FAQ erstellt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SupportFAQ> & { id: string }) => {
      const { error } = await supabase.from('support_faq').update(updates as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('FAQ aktualisiert'); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('support_faq').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('FAQ gelöscht'); },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const { error } = await supabase.from('support_faq')
        .update({ is_published: published } as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Status geändert'); },
  });

  return { create, update, remove, togglePublish };
}
