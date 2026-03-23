import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, X } from 'lucide-react';

export function StickyCTA() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Show after scrolling past the hero (~600px)
      setVisible(window.scrollY > 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (dismissed || !visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 animate-fade-in">
      <div className="container mx-auto max-w-2xl">
        <div className="glass-strong rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-lg border border-primary/20">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold whitespace-nowrap">39 € einmalig</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">· 12 Monate · Kein Abo</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/shop">
              <Button size="sm" className="gradient-primary text-primary-foreground rounded-xl h-9 px-4 text-sm group whitespace-nowrap">
                Jetzt starten
                <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
              </Button>
            </Link>
            <button
              onClick={() => setDismissed(true)}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground"
              aria-label="Schließen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
