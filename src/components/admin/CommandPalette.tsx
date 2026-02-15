import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { adminNavFlat } from '@/admin/adminNav';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const items = adminNavFlat();

  const navItems = items.filter(i => i.group === 'Navigation');
  const actionItems = items.filter(i => i.group === 'Schnellaktionen');

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
          {navItems.map(item => {
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
          {actionItems.map(item => {
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
