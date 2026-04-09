import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ── Partner Account ──

export function usePartnerAccount() {
  return useQuery({
    queryKey: ['partner-account'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('partner_accounts' as any)
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
      const { data, error } = await supabase.rpc('get_partner_dashboard_summary' as any, {
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
      const { data, error } = await supabase
        .from('partner_tracking_links' as any)
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
      const { data, error } = await supabase
        .from('partner_tracking_links' as any)
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
      const { data, error } = await supabase
        .from('partner_commissions' as any)
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
      const { data, error } = await supabase
        .from('partner_payout_requests' as any)
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
      const { data, error } = await supabase
        .from('partner_payout_requests' as any)
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
      const { data, error } = await supabase
        .from('partner_leads' as any)
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!partnerId,
  });
}

// ── Assets ──

export function usePartnerAssets() {
  return useQuery({
    queryKey: ['partner-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partner_assets' as any)
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// ── Admin Hooks ──

export function useAdminPartners() {
  return useQuery({
    queryKey: ['admin-partners'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-partner-api', {
        body: {},
        headers: {},
      });
      // Use query param approach
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-partner-api?action=list_partners`,
        {
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      return json.data;
    },
  });
}

export function useAdminPartnerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, body }: { action: string; body?: Record<string, any> }) => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-partner-api?action=${action}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body || {}),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Action failed');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-partners'] });
    },
  });
}
