import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import GrowthSeoCommandCenter from '@/components/admin/command/GrowthSeoCommandCenter';

const Fallback = () => (
  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
);

// Lazy-load sub-pages to keep initial bundle small
const ContentPagesList = lazy(() => import('@/pages/admin/v4/ContentCRMSupportPages').then(m => ({ default: m.ContentPagesList })));
const BlogPostsList = lazy(() => import('@/pages/admin/v4/ContentCRMSupportPages').then(m => ({ default: m.BlogPostsList })));
const SocialEnginePage = lazy(() => import('@/pages/admin/v4/SocialEnginePage'));

const tabs = [
  { path: '/admin/growth', label: 'Command Center', end: true },
  { path: '/admin/growth/content', label: 'Seiten' },
  { path: '/admin/growth/blog', label: 'Blog' },
  { path: '/admin/growth/social', label: 'Social Engine' },
];

export default function GrowthPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => t.end
    ? location.pathname === t.path
    : location.pathname.startsWith(t.path)
  )?.path || tabs[0].path;

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors whitespace-nowrap",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Routes>
        <Route index element={<GrowthSeoCommandCenter />} />
        <Route path="content" element={<Suspense fallback={<Fallback />}><ContentPagesList /></Suspense>} />
        <Route path="blog" element={<Suspense fallback={<Fallback />}><BlogPostsList /></Suspense>} />
        <Route path="social/*" element={<Suspense fallback={<Fallback />}><SocialEnginePage /></Suspense>} />
      </Routes>
    </div>
  );
}
