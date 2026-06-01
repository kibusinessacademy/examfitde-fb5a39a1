import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, GraduationCap, Receipt, Download, KeyRound, User, ShieldCheck, Building2 } from 'lucide-react';
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
} from '@/components/ui/sidebar';
import { Helmet } from 'react-helmet-async';
import { useHasOrgAccess } from '@/hooks/useOrgConsole';

const items = [
  { title: 'Übersicht', url: '/app', icon: LayoutDashboard, end: true },
  { title: 'Meine Kurse', url: '/app/meine-kurse', icon: GraduationCap },
  { title: 'Rechnungen', url: '/app/rechnungen', icon: Receipt },
  { title: 'Downloads', url: '/app/downloads', icon: Download },
  { title: 'Lizenzen', url: '/app/lizenzen', icon: KeyRound },
  { title: 'Profil', url: '/app/profil', icon: User },
  { title: 'DSGVO', url: '/app/dsgvo', icon: ShieldCheck },
];

function AccountSidebar() {
  const { pathname } = useLocation();
  const { data: orgAccess } = useHasOrgAccess();
  const hasOrg = orgAccess?.hasAccess;
  const firstOrgId = orgAccess?.orgs?.[0]?.id;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Mein Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = item.end ? pathname === item.url : pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active}>
                      <NavLink to={item.url} end={item.end} className="flex items-center gap-2">
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

        {hasOrg && (
          <SidebarGroup>
            <SidebarGroupLabel>Unternehmen</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname.startsWith('/app/org')}>
                    <NavLink
                      to={firstOrgId ? `/app/org/${firstOrgId}` : '/app/org'}
                      className="flex items-center gap-2"
                    >
                      <Building2 className="h-4 w-4" />
                      <span>Org-Konsole</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

export default function AppLayout() {
  return (
    <SidebarProvider>
      <Helmet>
        <title>Mein Account – ExamFit</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <div className="min-h-screen flex w-full bg-background">
        <AccountSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center border-b border-border px-2">
            <SidebarTrigger />
            <h1 className="ml-3 text-sm font-medium text-text-secondary">Mein Account</h1>
          </header>
          <main className="flex-1 p-6 max-w-6xl w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
