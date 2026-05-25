import { useParams } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { ModuleLandingShell } from "@/components/berufos/ModuleLandingShell";
import { getModule } from "@/lib/berufos/modules";

/**
 * Dynamische Modul-Landing /berufos/:slug.
 * Liest aus BERUFOS_MODULES SSOT — 10 Routen aus einem File.
 */
export default function BerufOSModulePage() {
  const { slug } = useParams<{ slug: string }>();
  const module = slug ? getModule(slug) : undefined;
  if (!module) return <Navigate to="/berufos" replace />;
  return <ModuleLandingShell module={module} />;
}
