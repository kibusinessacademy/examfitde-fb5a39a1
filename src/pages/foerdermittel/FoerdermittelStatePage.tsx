import { Navigate, useParams } from "react-router-dom";
import { ClusterPage } from "@/components/foerdermittel/ClusterPage";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import { buildStateCluster, STATE_LABEL } from "@/lib/foerdermittel/seoAuthority";
import type { Region } from "@/lib/foerdermittel/types";

export default function FoerdermittelStatePage() {
  const { state } = useParams<{ state: string }>();
  if (!state) return <Navigate to="/foerdermittel" replace />;
  const key = state.toUpperCase() as Region;
  if (!STATE_LABEL[key]) return <Navigate to="/foerdermittel" replace />;
  const cluster = buildStateCluster(PROGRAMS, key);
  return <ClusterPage cluster={cluster} breadcrumbLabel={`Bundesland · ${STATE_LABEL[key]}`} />;
}
