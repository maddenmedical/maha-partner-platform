import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ClassSession, HomeworkSubmission } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { FileUp, Upload, Loader2, FileText, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

export default function Homework() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: sessions, isLoading: sessionsLoading } = useQuery<ClassSession[]>({ queryKey: ["/api/students/my-classes"] });
  const { data: submissions, isLoading: subsLoading } = useQuery<HomeworkSubmission[]>({ queryKey: ["/api/homework/mine"] });

  const now = Date.now();
  const pastSessions = sessions?.filter((s) => s.datetime < now).sort((a, b) => b.datetime - a.datetime) || [];

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Homework</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload your assignments for each past class session.</p>
      </div>

      {sessionsLoading || subsLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
        </div>
      ) : pastSessions.length === 0 ? (
        <EmptyState icon={FileUp} title="No past classes yet" description="Homework uploads will appear here after your first class session." />
      ) : (
        <div className="flex flex-col gap-3">
          {pastSessions.map((s) => (
            <HomeworkCard
              key={s.id}
              session={s}
              submissions={submissions?.filter((h) => h.classSessionId === s.id) || []}
              onUploaded={() => queryClient.invalidateQueries({ queryKey: ["/api/homework/mine"] })}
              toast={toast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HomeworkCard({
  session,
  submissions,
  onUploaded,
  toast,
}: {
  session: ClassSession;
  submissions: HomeworkSubmission[];
  onUploaded: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [comment, setComment] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await apiRequest("POST", "/api/homework/upload", formData, true);
      const uploadData = await uploadRes.json();
      return apiRequest("POST", "/api/homework", {
        classSessionId: session.id,
        fileUrl: uploadData.url,
        fileType: uploadData.type,
        comment: comment || undefined,
      });
    },
    onSuccess: () => {
      setFile(null);
      setComment("");
      onUploaded();
      toast({ title: "Homework submitted" });
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`card-homework-session-${session.id}`}>
      <CardContent className="p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium leading-snug">{session.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(session.datetime), "MMM d, yyyy")}</p>
        </div>

        {submissions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {submissions.map((sub) => (
              <div key={sub.id} className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-md px-2.5 py-1.5" data-testid={`row-submission-${sub.id}`}>
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate flex-1">{sub.comment || "Submitted file"}</span>
                <span className="shrink-0">{format(new Date(sub.createdAt), "MMM d")}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <label
            htmlFor={`file-${session.id}`}
            className="flex items-center gap-2 border border-input rounded-md px-3 py-2 text-sm cursor-pointer hover-elevate active-elevate-2"
            data-testid={`label-upload-homework-${session.id}`}
          >
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground truncate">{file ? file.name : "Choose pptx / pdf / video / image..."}</span>
          </label>
          <input
            id={`file-${session.id}`}
            type="file"
            accept=".pdf,.pptx,image/*,video/*"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            data-testid={`input-homework-file-${session.id}`}
          />
          <Textarea
            placeholder="Optional comment"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            data-testid={`textarea-homework-comment-${session.id}`}
          />
          <Button
            size="sm"
            disabled={!file || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="self-start"
            data-testid={`button-submit-homework-${session.id}`}
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Submit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
