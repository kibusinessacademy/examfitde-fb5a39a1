import { ClusterPage } from "@/components/foerdermittel/ClusterPage";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import { buildAntragChecklistCluster } from "@/lib/foerdermittel/seoAuthority";

export default function FoerdermittelChecklistPage() {
  const cluster = buildAntragChecklistCluster(PROGRAMS);
  return <ClusterPage cluster={cluster} breadcrumbLabel="Antrag · Checkliste" />;
}
