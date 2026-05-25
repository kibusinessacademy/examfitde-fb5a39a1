import { useParams, Navigate } from "react-router-dom";
import { ModuleLandingShell } from "@/components/berufos/ModuleLandingShell";
import { getModule } from "@/lib/berufos/modules";

interface Props {
  /** Optional fixed slug (für root-level Module-Routes /agents, /documents, ...). */
  slug?: string;
}

/**
 * Dynamische Modul-Landing.
 * Hardcut 2026-05-25: Module sind sowohl unter /<slug> als auch /berufos/<slug>
 * erreichbar. /berufos/<slug> bleibt als Legacy-Alias funktional.
 * Liest aus BERUFOS_MODULES SSOT.
 */
export default function BerufOSModulePage({ slug: fixedSlug }: Props = {}) {
  const { slug: paramSlug } = useParams<{ slug: string }>();
  const slug = fixedSlug ?? paramSlug;
  const module = slug ? getModule(slug) : undefined;
  if (!module) return <Navigate to="/" replace />;
  return <ModuleLandingShell module={module} />;
}
