import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Checks if the current user has access to a product via org license.
 * This is the B2B access path — complementary to personal entitlements.
 *
 * Access logic (SSOT):
 *   IF user_has_entitlement(product) → allow
 *   ELSE IF check_org_license_access(user, product) → allow
 *   ELSE → paywall
 */
export function useOrgLicenseAccess(productId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['org-license-access', productId, user?.id],
    queryFn: async (): Promise<boolean> => {
      if (!user || !productId) return false;

      const { data, error } = await supabase.rpc('check_org_license_access', {
        p_user_id: user.id,
        p_product_id: productId,
      });

      if (error) {
        console.error('Org license check error:', error);
        return false;
      }

      return data === true;
    },
    enabled: !!user && !!productId,
    staleTime: 1000 * 60 * 5, // 5 min
  });
}

export interface OrgMembership {
  id: string;
  org_id: string;
  role: 'owner' | 'admin' | 'manager' | 'learner';
  status: string;
  org_name?: string;
  org_type?: string;
}

/**
 * Returns the current user's organization memberships.
 */
export function useUserOrganizations() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['user-organizations', user?.id],
    queryFn: async (): Promise<OrgMembership[]> => {
      if (!user) return [];

      const { data, error } = await (supabase as any)
        .from('org_memberships')
        .select(`
          id, org_id, role, status,
          organizations!inner(name, org_type)
        `)
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (error) {
        console.error('User organizations error:', error);
        return [];
      }

      return (data || []).map((m: any) => ({
        id: m.id,
        org_id: m.org_id,
        role: m.role,
        status: m.status,
        org_name: m.organizations?.name,
        org_type: m.organizations?.org_type,
      }));
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 10,
  });
}
