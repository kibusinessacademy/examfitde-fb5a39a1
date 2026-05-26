import { Navigate, useParams } from "react-router-dom";
import { ClusterPage } from "@/components/foerdermittel/ClusterPage";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import { buildIndustryCluster, INDUSTRY_LABEL } from "@/lib/foerdermittel/seoAuthority";

export default function FoerdermittelIndustryPage() {
  const { industry } = useParams<{ industry: string }>();
  if (!industry || !INDUSTRY_LABEL[industry]) return <Navigate to="/foerdermittel" replace />;
  const cluster = buildIndustryCluster(PROGRAMS, industry);
  return <ClusterPage cluster={cluster} breadcrumbLabel={`Branche · ${INDUSTRY_LABEL[industry]}`} />;
}
