import {
  LayoutDashboard, BookOpen, Shield, Activity, DollarSign,
  TrendingUp, Layers, Plus, FileText, Brain, Headphones,
  Users, Radio, Globe, Image, Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AdminNavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  group: 'navigation' | 'actions';
  children?: { path: string; label: string }[];
}

/** SSOT: Used by Sidebar + CommandPalette */
export const adminNavModules: AdminNavItem[] = [
  { path: '/admin/command', label: 'Leitstelle', icon: LayoutDashboard, group: 'navigation' },
  {
    path: '/admin/ops', label: 'Ops', icon: Activity, group: 'navigation',
    children: [
      { path: '/admin/ops', label: 'Ampel & Alerts' },
      { path: '/admin/ops/queue', label: 'Queue' },
      { path: '/admin/pipeline', label: 'Pipeline Live' },
      { path: '/admin/ops/ai-workers', label: 'AI Workers' },
    ],
  },
  {
    path: '/admin/studio', label: 'Factory', icon: BookOpen, group: 'navigation',
    children: [
      { path: '/admin/studio', label: 'Pakete' },
      { path: '/admin/studio/new', label: 'Neues Paket' },
    ],
  },
  {
    path: '/admin/quality', label: 'Qualität', icon: Shield, group: 'navigation',
    children: [
      { path: '/admin/quality', label: 'Übersicht' },
      { path: '/admin/quality/review', label: 'Review Inbox' },
    ],
  },
  {
    path: '/admin/content', label: 'Content & SEO', icon: FileText, group: 'navigation',
    children: [
      { path: '/admin/content', label: 'Seiten' },
      { path: '/admin/content/blog', label: 'Blog' },
      { path: '/admin/content/assets', label: 'Assets' },
      { path: '/admin/content/seo', label: 'SEO & Redirects' },
    ],
  },
  { path: '/admin/crm', label: 'CRM', icon: Users, group: 'navigation' },
  { path: '/admin/support', label: 'Support', icon: Headphones, group: 'navigation' },
  {
    path: '/admin/business', label: 'Finanzen', icon: DollarSign, group: 'navigation',
    children: [
      { path: '/admin/business', label: 'Übersicht' },
      { path: '/admin/business/licenses', label: 'Lizenzen' },
    ],
  },
  { path: '/admin/growth', label: 'Wachstum', icon: TrendingUp, group: 'navigation' },
  { path: '/admin/scale', label: 'Skalierung', icon: Layers, group: 'navigation' },
];

export const adminQuickActions: AdminNavItem[] = [
  { label: 'Dead Letter anzeigen', path: '/admin/ops/deadletter', icon: Activity, group: 'actions' },
  { label: 'Live Logs öffnen', path: '/admin/ops/logs', icon: FileText, group: 'actions' },
  { label: 'Steuer-Export', path: '/admin/business/exports', icon: DollarSign, group: 'actions' },
  { label: 'AZAV Compliance', path: '/admin/quality/azav', icon: Shield, group: 'actions' },
  { label: 'Churn Dashboard', path: '/admin/growth', icon: TrendingUp, group: 'actions' },
  { label: 'AI Workers', path: '/admin/ops/ai-workers', icon: Brain, group: 'actions' },
  { label: 'System-Handbuch', path: '/admin/handbook', icon: BookOpen, group: 'actions' },
];

/** Flat list for CommandPalette search */
export function adminNavFlat() {
  const items: { label: string; path: string; icon: LucideIcon; group: string }[] = [];

  for (const mod of adminNavModules) {
    items.push({ label: mod.label, path: mod.path, icon: mod.icon, group: 'Navigation' });
    if (mod.children) {
      for (const child of mod.children) {
        // Skip duplicates where child.path === parent.path
        if (child.path !== mod.path) {
          items.push({ label: `${mod.label} → ${child.label}`, path: child.path, icon: mod.icon, group: 'Navigation' });
        }
      }
    }
  }

  for (const action of adminQuickActions) {
    items.push({ label: action.label, path: action.path, icon: action.icon, group: 'Schnellaktionen' });
  }

  return items;
}
