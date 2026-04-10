import { ReactNode, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrgConsoleContext, OrgListItem } from '@/hooks/useOrgConsole';
import { Loader2, Building2, ChevronDown, School, Landmark, Handshake } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

const ORG_TYPE_ICON: Record<string, any> = {
  SCHOOL: School,
  UNIVERSITY: School,
  IHK: Landmark,
  HWK: Landmark,
  PARTNER_AGENCY: Handshake,
  PARTNER_AFFILIATE: Handshake,
};

const ORG_TYPE_LABEL: Record<string, string> = {
  SCHOOL: 'Schul-Konsole',
  UNIVERSITY: 'Hochschul-Konsole',
  IHK: 'IHK Governance',
  HWK: 'HWK Governance',
  COMPANY: 'Enterprise Console',
  PARTNER_AGENCY: 'Partner Console',
  PARTNER_AFFILIATE: 'Partner Console',
};

interface OrgConsoleShellProps {
  children: (ctx: {
    orgId: string;
    orgName: string;
    orgType: string;
    myRole: string;
    capabilities: Record<string, boolean>;
    context: ReturnType<typeof useOrgConsoleContext>['data'];
    isLoading: boolean;
  }) => ReactNode;
}

export default function OrgConsoleShell({ children }: OrgConsoleShellProps) {
  const { user, loading: authLoading } = useAuth();
  const [selectedOrgId, setSelectedOrgId] = useState<string | undefined>();
  const { data, isLoading } = useOrgConsoleContext(selectedOrgId);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  const orgs = data?.orgs || [];
  const selected = data?.selected;
  const managementRoles = ['OWNER', 'MANAGER', 'IT_ADMIN', 'BILLING', 'SCHOOL_ADMIN', 'IHK_ADMIN', 'HWK_ADMIN', 'INSTRUCTOR'];
  const accessibleOrgs = orgs.filter(o => managementRoles.includes(o.my_role));

  if (accessibleOrgs.length === 0) {
    return <Navigate to="/" replace />;
  }

  const orgId = selected?.org?.id || accessibleOrgs[0]?.id || '';
  const orgName = selected?.org?.name || accessibleOrgs[0]?.name || 'Organisation';
  const orgType = selected?.org?.org_type || accessibleOrgs[0]?.org_type || 'COMPANY';
  const myRole = selected?.my_role || accessibleOrgs[0]?.my_role || '';
  const capabilities = selected?.capabilities || {};

  const IconComponent = ORG_TYPE_ICON[orgType] || Building2;
  const consoleLabel = ORG_TYPE_LABEL[orgType] || 'Enterprise Console';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center gap-3">
          <IconComponent className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm text-foreground">{consoleLabel}</span>
          <span className="text-muted-foreground text-xs">|</span>

          {accessibleOrgs.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 text-sm font-medium">
                  {orgName}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {accessibleOrgs.map((o: OrgListItem) => (
                  <DropdownMenuItem key={o.id} onClick={() => setSelectedOrgId(o.id)}>
                    {o.name}
                    <span className="ml-2 text-[10px] text-muted-foreground">{o.org_type}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-sm font-medium text-foreground">{orgName}</span>
          )}

          <div className="ml-auto text-[10px] text-muted-foreground capitalize">
            {myRole.replace(/_/g, ' ')}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-4">
        {children({ orgId, orgName, orgType, myRole, capabilities, context: data, isLoading })}
      </main>
    </div>
  );
}
