import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { computeReadiness, fetchWeaknessMap, type ReadinessResult } from "@/features/mastery/api/masteryApi";
import { ReadinessCard } from "@/features/mastery/components/ReadinessCard";
import { WeaknessList, type WeaknessRow } from "@/features/mastery/components/WeaknessList";

interface MasteryDashboardSectionProps {
  curriculumId: string;
}

export function MasteryDashboardSection({ curriculumId }: MasteryDashboardSectionProps) {
  const { user } = useAuth();

  const { data: readiness, isLoading: readinessLoading } = useQuery({
    queryKey: ["mastery-readiness", user?.id, curriculumId],
    queryFn: () => computeReadiness({ userId: user!.id, curriculumId }),
    enabled: !!user && !!curriculumId,
    staleTime: 60_000,
  });

  const { data: weaknesses = [], isLoading: weaknessLoading } = useQuery({
    queryKey: ["mastery-weakness-map", user?.id, curriculumId],
    queryFn: () => fetchWeaknessMap(user!.id, curriculumId),
    enabled: !!user && !!curriculumId,
    staleTime: 60_000,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ReadinessCard
        readiness={readiness ?? null}
        isLoading={readinessLoading}
        curriculumId={curriculumId}
      />
      <WeaknessList
        items={weaknesses as WeaknessRow[]}
        isLoading={weaknessLoading}
      />
    </div>
  );
}
