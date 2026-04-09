import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { IntegrationStatus, LtiRegistration, ScimToken } from '@/types/enterprise';

export function useLtiRegistrations() {
  return useQuery({
    queryKey: ['lti-registrations'],
    queryFn: async (): Promise<LtiRegistration[]> => {
      const { data, error } = await supabase
        .from('lti_platform_registrations')
        .select('id, issuer, client_id, auth_login_url, keyset_url, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LtiRegistration[];
    },
  });
}

export function useScimTokens() {
  return useQuery({
    queryKey: ['scim-tokens'],
    queryFn: async (): Promise<ScimToken[]> => {
      const { data, error } = await supabase
        .from('scim_tokens')
        .select('id, label, org_id, is_active, created_at, expires_at, last_used_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ScimToken[];
    },
  });
}

export function useIntegrationSummary() {
  const lti = useLtiRegistrations();
  const scim = useScimTokens();

  const ltiStatus: IntegrationStatus = lti.data?.some(r => r.status === 'active')
    ? 'connected'
    : 'not_configured';

  const scimStatus: IntegrationStatus = scim.data?.some(t => t.is_active)
    ? 'connected'
    : 'not_configured';

  return {
    lti: { status: ltiStatus, registrations: lti.data ?? [], isLoading: lti.isLoading },
    scim: { status: scimStatus, tokens: scim.data ?? [], isLoading: scim.isLoading },
    isLoading: lti.isLoading || scim.isLoading,
  };
}
