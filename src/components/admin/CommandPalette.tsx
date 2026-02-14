import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import {
  LayoutDashboard, BookOpen, Shield, Activity, DollarSign,
  TrendingUp, Layers, Plus, Search, FileText, Brain
} from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAV_ITEMS = [
  { label: 'Leitstelle', path: '/admin/command', icon: LayoutDashboard, group: 'Navigation' },
  { label: 'Kurs-Studio', path: '/admin/studio', icon: BookOpen, group: 'Navigation' },
  { label: 'Neues Paket erstellen', path: '/admin/studio/new', icon: Plus, group: 'Navigation' },
  { label: 'Qualität & Compliance', path: '/admin/quality', icon: Shield, group: 'Navigation' },
  { label: 'System & Betrieb', path: '/admin/ops', icon: Activity, group: 'Navigation' },
  { label: 'Finanzen', path: '/admin/business', icon: DollarSign, group: 'Navigation' },
  { label: 'Wachstum & CRM', path: '/admin/growth', icon: TrendingUp, group: 'Navigation' },
  { label: 'Skalierung (300 Berufe)', path: '/admin/scale', icon: Layers, group: 'Navigation' },
  { label: 'System-Handbuch', path: '/admin/handbook', icon: BookOpen, group: 'Navigation' },
];

const ACTIONS = [
  { label: 'Dead Letter anzeigen', path: '/admin/ops/deadletter', icon: Activity, group: 'Aktionen' },
  { label: 'Live Logs öffnen', path: '/admin/ops/logs', icon: FileText, group: 'Aktionen' },
  { label: 'Steuer-Export', path: '/admin/business/exports', icon: DollarSign, group: 'Aktionen' },
  { label: 'AZAV Compliance', path: '/admin/quality/azav', icon: Shield, group: 'Aktionen' },
  { label: 'Churn Dashboard', path: '/admin/growth', icon: TrendingUp, group: 'Aktionen' },
  { label: 'AI Workers', path: '/admin/ops/ai-workers', icon: Brain, group: 'Aktionen' },
];

export default function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();

  const handleSelect = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Seite oder Aktion suchen…" />
      <CommandList>
        <CommandEmpty>Keine Ergebnisse gefunden.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            return (
              <CommandItem key={item.path} onSelect={() => handleSelect(item.path)}>
                <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Schnellaktionen">
          {ACTIONS.map(item => {
            const Icon = item.icon;
            return (
              <CommandItem key={item.path} onSelect={() => handleSelect(item.path)}>
                <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
