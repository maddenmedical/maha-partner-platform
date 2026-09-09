import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import type { Course, Video } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PlayCircle, Lock, GraduationCap, Loader2, CheckCircle2, Ticket } from "lucide-react";

type CourseWithLessons = Course & { lessons: Video[]; lessonCount: number; hasAccess: boolean };

function formatPrice(cents: number, currency: string) {
  const symbol = currency.toLowerCase() === "eur" ? "€" : "";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

// Read the session_id / checkout query params out of the hash route
// (e.g. "#/videos?session_id=cs_test_..."). Hash routing keeps the query
// string after the hash, so window.location.search is empty.
function readHashParams(): URLSearchParams {
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  return new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : "");
}

function clearHashParams() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  if (qIndex >= 0) window.location.hash = hash.slice(0, qIndex);
}

export default function Videos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: courses, isLoading } = useQuery<CourseWithLessons[]>({ queryKey: ["/api/courses"] });
  const confirmedRef = useRef(false);
  const [redeemCode, setRedeemCode] = useState<Record<number, string>>({});

  // After Stripe redirects back with ?session_id=..., confirm the purchase.
  useEffect(() => {
    if (confirmedRef.current) return;
    const params = readHashParams();
    const sessionId = params.get("session_id");
    if (params.get("checkout") === "cancelled") {
      confirmedRef.current = true;
      clearHashParams();
      toast({ title: "Checkout cancelled", description: "No charge was made." });
      return;
    }
    if (!sessionId) return;
    confirmedRef.current = true;
    clearHashParams();
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/courses/checkout/confirm?session_id=${encodeURIComponent(sessionId)}`);
        await res.json();
        toast({ title: "Course unlocked", description: "Your purchase is complete — enjoy the lectures!" });
        queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      } catch {
        toast({
          title: "Could not confirm payment",
          description: "If you completed payment, contact the MAHA team and we'll unlock it.",
          variant: "destructive",
        });
      }
    })();
  }, [toast, queryClient]);

  const enrollMutation = useMutation({
    mutationFn: async (courseId: number) => {
      await apiRequest("POST", `/api/courses/${courseId}/enroll`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Enrolled", description: "You now have access to this course." });
    },
    onError: () => {
      toast({ title: "Could not enroll", description: "Please try again.", variant: "destructive" });
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async ({ courseId, code }: { courseId: number; code: string }) => {
      const res = await fetch(`${API_BASE}/api/courses/redeem-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Invalid code");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      setRedeemCode((prev) => ({ ...prev, [variables.courseId]: "" }));
      toast({ title: "Access unlocked", description: "Enjoy the lectures!" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not redeem code", description: err.message, variant: "destructive" });
    },
  });

  const buyMutation = useMutation({
    mutationFn: async (courseId: number) => {
      // Manual fetch (not apiRequest) so we can inspect the 503 gate body
      // without the shared error-throwing wrapper swallowing it.
      const res = await fetch(`${API_BASE}/api/courses/${courseId}/checkout`, { method: "POST", credentials: "include" });
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === "payments_not_configured") {
          return { notConfigured: true } as const;
        }
      }
      if (!res.ok) throw new Error("checkout_failed");
      const body = await res.json();
      return body as { url?: string; alreadyOwned?: boolean; notConfigured?: boolean };
    },
    onSuccess: (result) => {
      if ("notConfigured" in result && result.notConfigured) {
        toast({
          title: "Payment not set up yet",
          description: "Online payment isn't set up yet — contact the MAHA team to unlock this course.",
        });
        return;
      }
      if (result.alreadyOwned) {
        queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
        toast({ title: "Already unlocked", description: "You already have access to this course." });
        return;
      }
      if (result.url) {
        window.location.href = result.url;
      }
    },
    onError: () => {
      toast({ title: "Checkout failed", description: "Please try again later.", variant: "destructive" });
    },
  });

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Education</h1>
        <p className="text-sm text-muted-foreground mt-1">Clinical courses and lectures from the MAHA team.</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg skeleton-shimmer" />
          ))}
        </div>
      ) : !courses || courses.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No courses yet" description="Check back soon for new educational content." />
      ) : (
        courses.map((course) => {
          const isPaid = course.accessType === "paid" && !!course.priceCents;
          const priceLabel = isPaid ? formatPrice(course.priceCents!, course.currency) : "Free";
          return (
            <Card key={course.id} data-testid={`card-course-${course.id}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h2 className="text-base font-semibold leading-snug">{course.name}</h2>
                    {course.description && (
                      <p className="text-xs text-muted-foreground mt-1">{course.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">{course.lessonCount} lessons</p>
                  </div>
                  <Badge variant={isPaid ? "default" : "outline"} className="shrink-0" data-testid={`badge-price-${course.id}`}>
                    {priceLabel}
                  </Badge>
                </div>

                {course.hasAccess ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" /> You have access
                    </div>
                    <ul className="flex flex-col divide-y divide-border rounded-md border">
                      {course.lessons.map((lesson) => {
                        const playable = !!lesson.url;
                        return (
                          <li key={lesson.id} className="flex items-center gap-3 p-3" data-testid={`lesson-${lesson.id}`}>
                            {playable ? (
                              <a
                                href={lesson.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary shrink-0"
                                data-testid={`link-watch-${lesson.id}`}
                              >
                                <PlayCircle className="h-5 w-5" />
                              </a>
                            ) : (
                              <PlayCircle className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm leading-snug">{lesson.title}</p>
                              {!playable && (
                                <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-coming-soon-${lesson.id}`}>
                                  Video coming soon
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" /> {course.lessonCount} lessons locked
                    </div>
                    {isPaid ? (
                      <>
                        <Button
                          onClick={() => buyMutation.mutate(course.id)}
                          disabled={buyMutation.isPending}
                          data-testid={`button-buy-${course.id}`}
                        >
                          {buyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Buy access — {priceLabel} — unlock all {course.lessonCount} lectures
                        </Button>
                        <div className="flex items-center gap-2">
                          <Ticket className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <Input
                            placeholder="Have a code? Enter it here"
                            value={redeemCode[course.id] || ""}
                            onChange={(e) => setRedeemCode((prev) => ({ ...prev, [course.id]: e.target.value }))}
                            className="h-8 text-sm"
                            data-testid={`input-redeem-code-${course.id}`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!redeemCode[course.id] || redeemMutation.isPending}
                            onClick={() => redeemMutation.mutate({ courseId: course.id, code: redeemCode[course.id] })}
                            data-testid={`button-redeem-${course.id}`}
                          >
                            {redeemMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Redeem"}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => enrollMutation.mutate(course.id)}
                        disabled={enrollMutation.isPending}
                        data-testid={`button-enroll-${course.id}`}
                      >
                        {enrollMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Enroll — free
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
