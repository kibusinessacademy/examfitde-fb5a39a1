import { ReactNode, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrgConsoleContext, OrgListItem } from '@/hooks/useOrgConsole';
import { Loader2, Building2, ChevronDown } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface OrgConsoleShellProps {
  children: (ctx: {
    orgId: string;
    orgName: string;
    myRole: string;
    context: ReturnType<typeof useOrgConsoleContext>['data'];
    isLoading: boolean;
  }) => ReactNode;
}

export default function OrgConsoleShell({ children }: OrgConsoleShellProps) {
  const { user, loading: authLoading } = useAuth();
  const [selectedOrgId, setSelectedOrgId] = useState<string | undefined>();
  const { data, isLoading } = useOrgConsoleContext(selectedOrgId);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const orgs = data?.orgs || [];
  const selected = data?.selected;
  const managementRoles = ['OWNER', 'MANAGER', 'IT_ADMIN', 'BILLING'];
  const accessibleOrgs = orgs.filter(o => managementRoles.includes(o.my_role));

  if (accessibleOrgs.length === 0) {
    return <Navigate to="/" replace />;
  }

  const orgId = selected?.org?.id || accessibleOrgs[0]?.id || '';
  const orgName = selected?.org?.name || accessibleOrgs[0]?.name || 'Organisation';
  const myRole = selected?.my_role || accessibleOrgs[0]?.my_role || '';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center gap-3">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm text-foreground">Enterprise Console</span>
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
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-sm font-medium text-foreground">{orgName}</span>
          )}

          <div className="ml-auto text-[10px] text-muted-foreground capitalize">
            {myRole.replace('_', ' ')}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1400px] mx-auto px-4 py-4">
        {children({ orgId, orgName, myRole, context: data, isLoading })}
      </main>
    </div>
  );
}
