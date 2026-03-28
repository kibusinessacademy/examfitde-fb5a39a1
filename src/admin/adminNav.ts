import { LayoutDashboard, BookOpen, ListChecks, GraduationCap, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AdminNavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  group: 'navigation' | 'actions';
  badgeKey?: string;
  children?: { path: string; label: string }[];
}

/** SSOT: V2-only active nav items */
export const adminNavModules: AdminNavItem[] = [
  { path: '/admin/command', label: 'Leitstelle', icon: LayoutDashboard, group: 'navigation' },
  {
    path: '/admin/studio', label: 'Kurse', icon: BookOpen, group: 'navigation',
    children: [
      { path: '/admin/studio', label: 'Kurs-Pakete' },
    ],
  },
  { path: '/admin/queue', label: 'Queue', icon: ListChecks, group: 'navigation' },
  { path: '/admin/learner-preview', label: 'Learner Preview', icon: GraduationCap, group: 'navigation' },
  { path: '/admin/growth', label: 'Growth Cockpit', icon: TrendingUp, group: 'navigation' },
];

export const adminQuickActions: AdminNavItem[] = [];

/** Flat list for CommandPalette search */
export function adminNavFlat() {
  const items: { label: string; path: string; icon: LucideIcon; group: string }[] = [];
  for (const mod of adminNavModules) {
    items.push({ label: mod.label, path: mod.path, icon: mod.icon, group: 'Navigation' });
    if (mod.children) {
      for (const child of mod.children) {
        if (child.path !== mod.path) {
          items.push({ label: `${mod.label} → ${child.label}`, path: child.path, icon: mod.icon, group: 'Navigation' });
        }
      }
    }
  }
  return items;
}
