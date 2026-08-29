import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { getGreetingName } from "@/lib/utils";
import type { ClassSession } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, FileUp, MessageSquare, ArrowRight } from "lucide-react";
import { format } from "date-fns";

type SessionWithNames = ClassSession & { moduleName?: string; cohortName?: string };

export default function StudentHome() {
  const { user } = useAuth();
  const { data: sessions, isLoading } = useQuery<SessionWithNames[]>({ queryKey: ["/api/students/my-classes"] });

  const now = Date.now();
  const nextClass = sessions?.filter((s) => s.datetime >= now).sort((a, b) => a.datetime - b.datetime)[0];

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-welcome">Welcome back, {getGreetingName(user ?? {})}</h1>
        <p className="text-sm text-muted-foreground mt-1">Your Institute learning hub.</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
      ) : nextClass ? (
        <Card data-testid="card-next-class">
          <CardContent className="p-4 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Next class</span>
            <span className="text-sm font-medium">{nextClass.title}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {format(new Date(nextClass.datetime), "EEEE, MMM d 'at' HH:mm")}
            </span>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">No upcoming classes scheduled yet.</CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Quick links</h2>
        <Link href="/classes" className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2" data-testid="link-quick-classes">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">My classes</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/homework" className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2" data-testid="link-quick-homework">
          <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 text-accent" />
            <span className="text-sm font-medium">Homework</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/chat" className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2" data-testid="link-quick-chat">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-5 w-5 text-chart-4" />
            <span className="text-sm font-medium">Chat with MAHA team</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}
