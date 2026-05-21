import { Navigate, useParams } from 'react-router-dom';

/**
 * Redirects a legacy parameterized route to a new base path, preserving the first param value
 * as the trailing slug. e.g. /product/:slug + to="/paket" → /paket/<slug>.
 * If no slug is present, redirects to the base path.
 */
export function LegacyParamRedirect({ to }: { to: string }) {
  const params = useParams();
  const slug = params.slug || params.courseId || params.key || Object.values(params)[0];
  const target = slug ? `${to.replace(/\/$/, '')}/${slug}` : to;
  return <Navigate to={target} replace />;
}
