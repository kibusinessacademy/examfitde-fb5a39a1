import { Outlet, NavLink, useLocation, useNavigate, useParams, Navigate } from "react-router-dom";
import {
  Building2,
  LayoutDashboard,
  Users,
  KeyRound,
  Send,
  ScrollText,
  ChevronDown,
} from "lucide-react";
import { Helmet } from "react-helmet-async";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgConsoleContext } from "@/hooks/useOrgConsole";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const NAV = [
  { title: "Übersicht", path: "", end: true, icon: LayoutDashboard },
  { title: "Mitarbeiter", path: "team", icon: Users },
  { title: "Lizenzen & Sitze", path: "lizenzen", icon: KeyRound },
  { title: "Einladungen", path: "einladungen", icon: Send },
  { title: "Aktivität", path: "aktivitaet", icon: ScrollText },
];

function OrgSidebar({ orgId }: { orgId: string }) {
  const { pathname } = useLocation();
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5" /> Unternehmen
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const url = item.path ? `/app/org/${orgId}/${item.path}` : `/app/org/${orgId}`;
                const active = item.end
                  ? pathname === url || pathname === `${url}/`
                  : pathname.startsWith(url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active}>
                      <NavLink to={url} end={item.end} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function OrgSwitcher({ currentOrgId }: { currentOrgId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useOrgConsoleContext();
  const orgs = data?.orgs ?? [];
  const current = orgs.find((o) => o.id === currentOrgId);

  if (isLoading) return <Skeleton className="h-9 w-56" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 max-w-xs">
          <Building2 className="h-4 w-4 text-text-tertiary" />
          <span className="truncate font-medium">{current?.name ?? "Organisation wählen"}</span>
          <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Meine Organisationen</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.length === 0 ? (
          <div className="px-2 py-4 text-sm text-text-tertiary">Keine Organisation gefunden.</div>
        ) : (
          orgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => navigate(`/app/org/${org.id}`)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium">{org.name}</span>
              <span className="text-xs text-text-tertiary">
                {org.org_type} · Rolle: {org.my_role}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function OrgConsoleLayout() {
  const { orgId: orgIdParam } = useParams<{ orgId?: string }>();
  const { data, isLoading } = useOrgConsoleContext();
  const orgs = data?.orgs ?? [];

  // No orgId → pick first or empty state
  if (!orgIdParam) {
    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Skeleton className="h-12 w-48" />
        </div>
      );
    }
    if (orgs.length > 0) {
      return <Navigate to={`/app/org/${orgs[0].id}`} replace />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full p-8 text-center shadow-elev-2 border-border">
          <Building2 className="h-12 w-12 mx-auto mb-4 text-text-tertiary" />
          <h2 className="text-xl font-semibold mb-2 text-text-primary">Keine Organisation</h2>
          <p className="text-sm text-text-secondary mb-6">
            Du bist noch nicht Mitglied einer Unternehmens-Organisation. Sobald du eine Lizenz für dein
            Unternehmen kaufst oder eingeladen wirst, erscheint sie hier.
          </p>
          <Button asChild>
            <a href="/berufski/corporate">Unternehmens-Lizenz kaufen</a>
          </Button>
        </Card>
      </div>
    );
  }

  // orgId given but user has no access
  const current = orgs.find((o) => o.id === orgIdParam);
  if (!isLoading && !current) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full p-8 text-center shadow-elev-2 border-border">
          <Building2 className="h-12 w-12 mx-auto mb-4 text-status-warning" />
          <h2 className="text-xl font-semibold mb-2 text-text-primary">Kein Zugriff</h2>
          <p className="text-sm text-text-secondary mb-6">
            Du hast keine Berechtigung für diese Organisation.
          </p>
          <Button asChild variant="outline">
            <a href="/app/org">Zurück zur Org-Übersicht</a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Helmet>
        <title>Unternehmens-Konsole · BerufOS</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <div className="min-h-screen flex w-full bg-background">
        <OrgSidebar orgId={orgIdParam} />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center gap-3 border-b border-border px-3 bg-surface-1">
            <SidebarTrigger />
            <OrgSwitcher currentOrgId={orgIdParam} />
            {current && (
              <Badge variant="outline" className="text-xs">
                {current.org_type}
              </Badge>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                Rolle: {current?.my_role ?? "—"}
              </Badge>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto animate-in fade-in duration-300">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
