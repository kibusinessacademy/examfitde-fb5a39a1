import { useLocation } from 'react-router-dom';
import PageExplainer from '@/components/admin/PageExplainer';
import { getPageDescription } from '@/admin/pageDescriptions';

/**
 * AutoPageExplainer
 *
 * Rendert den PageExplainer automatisch basierend auf der aktuellen Route.
 * Ziel: Jede Admin-Seite erklärt sich selbst (SSOT), ohne Hardcode pro Page.
 */
export default function AutoPageExplainer() {
  const { pathname } = useLocation();

  // Handbook hat eigene, umfangreiche Header-Erklärungen → nicht doppelt rendern
  if (pathname.startsWith('/admin/handbook')) return null;

  const desc = getPageDescription(pathname);
  if (!desc) return null;

  return (
    <PageExplainer
      title={desc.title}
      description={desc.description}
      actions={desc.actions}
      tips={desc.tips}
    />
  );
}
