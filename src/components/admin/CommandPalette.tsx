import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { adminNavFlat } from '@/admin/adminNav';
import { useAdminSearch } from '@/hooks/useAdminSearch';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const entityTypeLabels: Record<string, string> = {
  course: 'Kurs', package: 'Paket', competency: 'Kompetenz',
  seo_page: 'SEO', product: 'Produkt', learner: 'Learner',
  blueprint: 'Blueprint', job: 'Job',
};

export default function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const items = adminNavFlat();
  const { results, loading, search } = useAdminSearch();
  const [query, setQuery] = useState('');

  const navItems = items.filter(i => i.group === 'Navigation');
  const actionItems = items.filter(i => i.group === 'Schnellaktionen');

  // Debounced entity search
  useEffect(() => {
    if (!open) { setQuery(''); return; }
    const timer = setTimeout(() => { if (query.length >= 2) search(query); }, 250);
    return () => clearTimeout(timer);
  }, [query, open, search]);

  const handleSelect = (path: string) => {
    navigate(path);
    onOpenChange(false);
    setQuery('');
  };

  // Filter nav items by query
  const q = query.toLowerCase();
  const filteredNav = q ? navItems.filter(i => i.label.toLowerCase().includes(q)) : navItems;
  const filteredActions = q ? actionItems.filter(i => i.label.toLowerCase().includes(q)) : actionItems;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Seite, Kurs, Kompetenz, Job suchen…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center gap-2 justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Suche…</span>
            </div>
          ) : query.length >= 2 ? (
            'Keine Ergebnisse gefunden.'
          ) : (
            'Suchbegriff eingeben…'
          )}
        </CommandEmpty>

        {/* Entity results from DB */}
        {results.length > 0 && (
          <>
            <CommandGroup heading="Gefundene Objekte">
              {results.map(r => (
                <CommandItem key={`${r.entity_type}-${r.entity_id}`} onSelect={() => handleSelect(r.url)}>
                  <Badge variant="outline" className="text-[10px] mr-2 shrink-0">
                    {entityTypeLabels[r.entity_type] || r.entity_type}
                  </Badge>
                  <span className="truncate">{r.title}</span>
                  {r.subtitle && (
                    <span className="text-xs text-muted-foreground ml-2 truncate">{r.subtitle}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {filteredNav.length > 0 && (
          <CommandGroup heading="Navigation">
            {filteredNav.map(item => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.path} onSelect={() => handleSelect(item.path)}>
                  <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {filteredActions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Schnellaktionen">
              {filteredActions.map(item => {
                const Icon = item.icon;
                return (
                  <CommandItem key={item.path} onSelect={() => handleSelect(item.path)}>
                    <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>{item.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
