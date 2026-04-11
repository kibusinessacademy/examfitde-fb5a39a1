import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import { trackConversion } from '@/lib/seo-tracking';

const EXCLUDED_ROUTES = ['/shop', '/checkout', '/auth', '/pruefungsreife-check', '/berufe'];
const SCROLL_THRESHOLD = 0.35;
const MOBILE_DELAY_MS = 2000;

export function StickyCTA() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [tracked, setTracked] = useState(false);
  const location = useLocation();

  const isExcluded = EXCLUDED_ROUTES.some(r => location.pathname.startsWith(r));

  useEffect(() => {
    if (isExcluded) return;

    let mobileTimer: ReturnType<typeof setTimeout> | null = null;
    const isMobile = window.innerWidth < 768;

    const onScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPct = docHeight > 0 ? window.scrollY / docHeight : 0;

      if (scrollPct >= SCROLL_THRESHOLD) {
        if (isMobile && !mobileTimer) {
          mobileTimer = setTimeout(() => setVisible(true), MOBILE_DELAY_MS);
        } else if (!isMobile) {
          setVisible(true);
        }
      } else {
        setVisible(false);
        if (mobileTimer) {
          clearTimeout(mobileTimer);
          mobileTimer = null;
        }
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (mobileTimer) clearTimeout(mobileTimer);
    };
  }, [isExcluded]);

  useEffect(() => {
    if (visible && !tracked) {
      trackConversion({ event: 'cta_click', source: 'sticky_cta', label: 'shown' });
      setTracked(true);
    }
  }, [visible, tracked]);

  if (dismissed || !visible || isExcluded) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 animate-fade-in">
      <div className="container mx-auto max-w-2xl">
        <div className="glass-strong rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-lg border border-primary/20">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold whitespace-nowrap">Passenden Kurs finden</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">· Beruf suchen · Direkt starten</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/berufe">
              <Button
                size="sm"
                className="gradient-primary text-primary-foreground rounded-xl h-9 px-4 text-sm group whitespace-nowrap"
                onClick={() => trackConversion({ event: 'cta_click', source: 'sticky_cta', label: 'clicked' })}
              >
                <Search className="h-4 w-4 mr-1" />
                Kurse finden
              </Button>
            </Link>
            <button
              onClick={() => {
                setDismissed(true);
                trackConversion({ event: 'cta_click', source: 'sticky_cta', label: 'dismissed' });
              }}
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
