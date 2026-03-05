import {
  LayoutDashboard, BookOpen, Shield, Activity, DollarSign,
  TrendingUp, Layers, Plus, FileText, Brain, Headphones,
  Users, Radio, Globe, Image, Search, HelpCircle, Sparkles,
  ScanEye,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AdminNavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  group: 'navigation' | 'actions';
  /** Key into NavBadges to show a count badge */
  badgeKey?: 'failed_jobs_24h' | 'critical_competencies' | 'seo_errors' | 'open_alerts';
  children?: { path: string; label: string }[];
}

/** SSOT: Used by Sidebar + CommandPalette */
export const adminNavModules: AdminNavItem[] = [
  { path: '/admin/command', label: 'Leitstelle', icon: LayoutDashboard, group: 'navigation' },
  {
    path: '/admin/ops', label: 'System', icon: Activity, group: 'navigation',
    badgeKey: 'failed_jobs_24h',
    children: [
      { path: '/admin/ops', label: 'Ampel & Alerts' },
      { path: '/admin/ops/queue', label: 'Auftragsliste' },
      { path: '/admin/pipeline', label: 'Pipeline Live' },
      { path: '/admin/ops/ai-workers', label: 'KI-Worker' },
    ],
  },
  {
    path: '/admin/studio', label: 'Kurse', icon: BookOpen, group: 'navigation',
    children: [
      { path: '/admin/studio', label: 'Kurs-Pakete' },
      { path: '/admin/studio/new', label: 'Neues Kurs-Paket' },
    ],
  },
  {
    path: '/admin/quality', label: 'Qualität', icon: Shield, group: 'navigation',
    badgeKey: 'critical_competencies',
    children: [
      { path: '/admin/quality', label: 'Übersicht' },
      { path: '/admin/quality/elite-matrix', label: 'Elite-Matrix' },
      { path: '/admin/quality/review', label: 'Review Inbox' },
    ],
  },
  {
    path: '/admin/content', label: 'Content & SEO', icon: FileText, group: 'navigation',
    badgeKey: 'seo_errors',
    children: [
      { path: '/admin/content', label: 'Seiten' },
      { path: '/admin/content/blog', label: 'Blog' },
      { path: '/admin/content/blocks', label: 'Inhaltsblöcke' },
      { path: '/admin/content/assets', label: 'Assets & Dateien' },
      { path: '/admin/content/media', label: 'Medien & Alt-Texte' },
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
  {
    path: '/admin/social', label: 'Social & Videos', icon: Radio, group: 'navigation',
    children: [
      { path: '/admin/social', label: 'Content-Engine' },
    ],
  },
  { path: '/admin/scale', label: 'Skalierung', icon: Layers, group: 'navigation' },
  {
    path: '/admin/work', label: 'ExamFit@work', icon: Sparkles, group: 'navigation',
    children: [
      { path: '/admin/work', label: 'Übersicht' },
      { path: '/admin/work/pipeline', label: 'Auto-Pipeline' },
      { path: '/admin/work/templates', label: 'Templates & Themes' },
      { path: '/admin/work/bundles', label: 'Bundle Builder' },
      { path: '/admin/work/licenses', label: 'Lizenzen' },
      { path: '/admin/work/commerce', label: 'Commerce & Coupons' },
      { path: '/admin/work/affiliates', label: 'Affiliate Dashboard' },
    ],
  },
  {
    path: '/admin/audit', label: 'System Audit', icon: ScanEye, group: 'navigation',
    children: [
      { path: '/admin/audit', label: 'Dashboard & Findings' },
    ],
  },
  {
    path: '/admin/handbook', label: 'Handbuch', icon: HelpCircle, group: 'navigation',
    children: [
      { path: '/admin/handbook', label: 'Übersicht' },
      { path: '/admin/handbook#glossar', label: 'Glossar' },
      { path: '/admin/handbook#faq', label: 'FAQ' },
    ],
  },
];

export const adminQuickActions: AdminNavItem[] = [
  { label: 'Fehlerkorb (Dead Letter)', path: '/admin/ops/deadletter', icon: Activity, group: 'actions' },
  { label: 'Live Logs öffnen', path: '/admin/ops/logs', icon: FileText, group: 'actions' },
  { label: 'Steuer-Export', path: '/admin/business/exports', icon: DollarSign, group: 'actions' },
  { label: 'AZAV Compliance', path: '/admin/quality/azav', icon: Shield, group: 'actions' },
  { label: 'Churn Dashboard', path: '/admin/growth', icon: TrendingUp, group: 'actions' },
  { label: 'KI-Worker', path: '/admin/ops/ai-workers', icon: Brain, group: 'actions' },
  { label: 'Admin-Handbuch', path: '/admin/handbook', icon: BookOpen, group: 'actions' },
];

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

  for (const action of adminQuickActions) {
    items.push({ label: action.label, path: action.path, icon: action.icon, group: 'Schnellaktionen' });
  }

  return items;
}
