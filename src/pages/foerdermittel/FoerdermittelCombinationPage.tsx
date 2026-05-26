import { Navigate, useParams } from "react-router-dom";
import { ClusterPage } from "@/components/foerdermittel/ClusterPage";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import { COMBINATIONS, buildCombinationCluster } from "@/lib/foerdermittel/seoAuthority";

export default function FoerdermittelCombinationPage() {
  const { slug } = useParams<{ slug: string }>();
  const def = COMBINATIONS.find((c) => c.slug === slug);
  if (!def) return <Navigate to="/foerdermittel" replace />;
  const cluster = buildCombinationCluster(PROGRAMS, def);
  return <ClusterPage cluster={cluster} breadcrumbLabel={`Kombination · ${def.label}`} />;
}
