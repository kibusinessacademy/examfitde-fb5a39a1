import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AccountSummary {
  active_courses: Array<{
    grant_id: string;
    package_id: string;
    package_name: string;
    package_slug: string | null;
    granted_at: string;
    expires_at: string | null;
    status: string;
  }>;
  invoice_count: number;
  latest_invoice: {
    id: string;
    invoice_number: string | null;
    total_cents: number;
    currency: string;
    status: string;
    pdf_url: string | null;
    issued_at: string | null;
  } | null;
  license_packages_owned: Array<{
    package_id: string;
    package_name: string;
    seats_total: number;
    seats_assigned: number;
  }>;
  pending_gdpr_request: {
    id: string;
    status: string;
    requested_at: string;
    scheduled_deletion_at: string | null;
  } | null;
}

export function useAccountSummary() {
  return useQuery({
    queryKey: ['account-summary'],
    queryFn: async (): Promise<AccountSummary> => {
      const { data, error } = await supabase.rpc('get_user_account_summary');
      if (error) throw error;
      return (data ?? {}) as unknown as AccountSummary;
    },
    staleTime: 30_000,
  });
}
