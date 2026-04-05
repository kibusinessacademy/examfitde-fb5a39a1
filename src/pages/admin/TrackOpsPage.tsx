import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrackControlCard } from "@/components/admin/TrackControlCard";
import { PublishReadinessCard } from "@/components/admin/PublishReadinessCard";
import { UpgradeCandidatesCard } from "@/components/admin/UpgradeCandidatesCard";
import { IntegrityFailuresCard } from "@/components/admin/IntegrityFailuresCard";

export default function TrackOpsPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Track Ops</h1>
        <p className="text-sm text-muted-foreground">
          Track-Compliance, Publish Gates, Upgrade-Kandidaten und Integrity-Blocker.
        </p>
      </div>

      <Tabs defaultValue="track-control" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 gap-2 md:grid-cols-4">
          <TabsTrigger value="track-control">Track Control</TabsTrigger>
          <TabsTrigger value="publish-readiness">Publish Readiness</TabsTrigger>
          <TabsTrigger value="upgrade-candidates">Upgrade Candidates</TabsTrigger>
          <TabsTrigger value="integrity-failures">Integrity Failures</TabsTrigger>
        </TabsList>

        <TabsContent value="track-control">
          <TrackControlCard />
        </TabsContent>

        <TabsContent value="publish-readiness">
          <PublishReadinessCard />
        </TabsContent>

        <TabsContent value="upgrade-candidates">
          <UpgradeCandidatesCard />
        </TabsContent>

        <TabsContent value="integrity-failures">
          <IntegrityFailuresCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
