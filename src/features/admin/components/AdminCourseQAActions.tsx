import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordAdminCourseTestRun } from "@/features/admin/api/adminCourseTestRunsApi";
import { toast } from "sonner";

export function AdminCourseQAActions({
  packageId,
  curriculumId,
}: {
  packageId: string;
  curriculumId: string;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: (args: {
      status: "tested" | "issue_found" | "approved";
      issueCodes?: string[];
    }) =>
      recordAdminCourseTestRun({
        packageId,
        curriculumId,
        testStatus: args.status,
        notes: notes || undefined,
        issueCodes: args.issueCodes ?? [],
      }),
    onSuccess: async () => {
      setNotes("");
      toast.success("QA-Status gespeichert");
      await qc.invalidateQueries({ queryKey: ["admin-course-test-run-latest"] });
      await qc.invalidateQueries({ queryKey: ["admin-course-test-run-history", packageId] });
      await qc.invalidateQueries({ queryKey: ["admin-auto-test-queue"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <div className="rounded-xl border p-3 space-y-2.5">
      <div className="text-xs font-medium text-muted-foreground">QA-Status setzen</div>

      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notiz / Befund…"
        className="h-8 text-sm"
      />

      <div className="grid grid-cols-3 gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutation.mutate({ status: "tested" })}
          disabled={mutation.isPending}
        >
          🧪 Getestet
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            mutation.mutate({
              status: "issue_found",
              issueCodes: ["manual_issue_found"],
            })
          }
          disabled={mutation.isPending}
        >
          ❌ Problem
        </Button>
        <Button
          size="sm"
          onClick={() => mutation.mutate({ status: "approved" })}
          disabled={mutation.isPending}
        >
          ✅ Freigeben
        </Button>
      </div>
    </div>
  );
}
