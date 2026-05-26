import { ClusterPage } from "@/components/foerdermittel/ClusterPage";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import { buildAktuellCluster } from "@/lib/foerdermittel/seoAuthority";

export default function FoerdermittelCurrentPage() {
  const cluster = buildAktuellCluster(PROGRAMS);
  return <ClusterPage cluster={cluster} breadcrumbLabel="FörderRadar · Aktuell" />;
}
