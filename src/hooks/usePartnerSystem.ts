import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ── Partner Account ──

export function usePartnerAccount() {
  return useQuery({
    queryKey: ['partner-account'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await (supabase as any)
        .from('partner_accounts')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// ── Dashboard Summary ──

export function usePartnerDashboardSummary(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-dashboard-summary', partnerId],
    queryFn: async () => {
      if (!partnerId) return null;
      const { data, error } = await (supabase as any).rpc('get_partner_dashboard_summary', {
        p_partner_id: partnerId,
      });
      if (error) throw error;
      return data as {
        total_clicks: number;
        clicks_30d: number;
        total_leads: number;
        active_attributions: number;
        total_commissions_eur: number;
        pending_commissions_eur: number;
        approved_commissions_eur: number;
        paid_commissions_eur: number;
        pending_payouts_eur: number;
        total_conversions: number;
      };
    },
    enabled: !!partnerId,
  });
}

// ── Tracking Links ──

export function usePartnerTrackingLinks(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-tracking-links', partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await (supabase as any)
        .from('partner_tracking_links')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!partnerId,
  });
}

export function useCreatePartnerTrackingLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (link: { partner_id: string; slug: string; target_path: string; campaign_name?: string; channel?: string }) => {
      const { data, error } = await (supabase as any)
        .from('partner_tracking_links')
        .insert(link)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['partner-tracking-links', vars.partner_id] });
    },
  });
}

// ── Commissions ──

export function usePartnerCommissions(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-commissions', partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await (supabase as any)
        .from('partner_commissions')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!partnerId,
  });
}

// ── Payouts ──

export function usePartnerPayouts(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-payouts', partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await (supabase as any)
        .from('partner_payout_requests')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!partnerId,
  });
}

export function useRequestPartnerPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ partner_id, amount }: { partner_id: string; amount: number }) => {
      const { data, error } = await (supabase as any)
        .from('partner_payout_requests')
        .insert({ partner_id, requested_amount_eur: amount })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['partner-payouts', vars.partner_id] });
      qc.invalidateQueries({ queryKey: ['partner-dashboard-summary', vars.partner_id] });
    },
  });
}

// ── Leads ──

export function usePartnerLeads(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-leads', partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await (supabase as any)
        .from('partner_leads')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!partnerId,
  });
}

export function useCreatePartnerLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      partner_id: string;
      lead_type?: string;
      org_name?: string;
      contact_name?: string;
      contact_email?: string;
      source?: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('create_partner_lead', {
        p_partner_id: params.partner_id,
        p_lead_type: params.lead_type || 'b2b',
        p_org_name: params.org_name || null,
        p_contact_name: params.contact_name || null,
        p_contact_email: params.contact_email || null,
        p_source: params.source || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['partner-leads', vars.partner_id] });
    },
  });
}

// ── Assets ──

export function usePartnerAssets() {
  return useQuery({
    queryKey: ['partner-assets'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('partner_assets')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// ── Content Engine ──

export function usePartnerContentJobs(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-content-jobs', partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await (supabase as any)
        .from('partner_content_jobs')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!partnerId,
  });
}

export function useGeneratePartnerContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      partner_id: string;
      blueprint_id?: string;
      question_id?: string;
      competency_id?: string;
      content_type: string;
      platform: string;
      tone?: string;
      target_group?: string;
    }) => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-partner-content`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Generation failed');
      return json;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['partner-content-jobs', vars.partner_id] });
    },
  });
}

// ── Admin Hooks ──

async function adminFetch(action: string, method = 'GET', body?: any) {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-partner-api?action=${action}`,
    {
      method,
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );
  const json = await res.json();
  if (!json.ok && json.error) throw new Error(json.error);
  return json;
}

export function useAdminPartners() {
  return useQuery({
    queryKey: ['admin-partners'],
    queryFn: () => adminFetch('list_partners').then(r => r.data),
  });
}

export function useAdminPartnerCommissions() {
  return useQuery({
    queryKey: ['admin-partner-commissions'],
    queryFn: () => adminFetch('list_commissions').then(r => r.data),
  });
}

export function useAdminPartnerPayouts() {
  return useQuery({
    queryKey: ['admin-partner-payouts'],
    queryFn: () => adminFetch('list_payouts').then(r => r.data),
  });
}

export function useAdminPartnerCommissionRules() {
  return useQuery({
    queryKey: ['admin-partner-commission-rules'],
    queryFn: () => adminFetch('list_commission_rules').then(r => r.data),
  });
}

export function useAdminPartnerAudit() {
  return useQuery({
    queryKey: ['admin-partner-audit'],
    queryFn: () => adminFetch('list_audit').then(r => r.data),
  });
}

export function useAdminPartnerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, body }: { action: string; body?: Record<string, any> }) => {
      return adminFetch(action, 'POST', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-partners'] });
      qc.invalidateQueries({ queryKey: ['admin-partner-commissions'] });
      qc.invalidateQueries({ queryKey: ['admin-partner-payouts'] });
    },
  });
}
