import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useInternalLinks, type InternalLinkSuggestion } from '@/hooks/useSEOKeywords';

interface Props {
  sourceUrl: string;
  /** Only show specific link types, e.g. ['cluster_to_product'] */
  linkTypes?: string[];
  title?: string;
  maxLinks?: number;
  className?: string;
}

export function SEOInternalLinks({ sourceUrl, linkTypes, title, maxLinks = 8, className = '' }: Props) {
  const { data: links } = useInternalLinks(sourceUrl);

  const filtered = (links ?? [])
    .filter(l => !linkTypes || linkTypes.includes(l.link_type))
    .slice(0, maxLinks);

  if (filtered.length === 0) return null;

  // Group by link_type for structured display
  const productLinks = filtered.filter(l => l.link_type === 'cluster_to_product');
  const clusterLinks = filtered.filter(l => l.link_type !== 'cluster_to_product');

  return (
    <nav aria-label="Verwandte Inhalte" className={className}>
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      
      {clusterLinks.length > 0 && (
        <ul className="space-y-2 mb-4">
          {clusterLinks.map(link => (
            <li key={link.id}>
              <Link
                to={link.target_url}
                className="text-primary hover:underline inline-flex items-center gap-1.5 text-sm"
              >
                {link.anchor_text}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {productLinks.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {productLinks.map(link => (
            <Link
              key={link.id}
              to={link.target_url}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors group"
            >
              <span className="text-sm font-medium">{link.anchor_text}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
