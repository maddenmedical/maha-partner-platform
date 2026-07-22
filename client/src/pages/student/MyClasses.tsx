import { useQuery } from "@tanstack/react-query";
import type { ClassSession } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { CalendarClock, ExternalLink, GraduationCap } from "lucide-react";
import { format } from "date-fns";
// Client-provided brand photography: Dr. Perko examining a sample under the microscope.
import institutePhoto from "@/assets/brand/perko-microscope-solo.jpg";

type SessionWithNames = ClassSession & { cohortName?: string; moduleName?: string };

export default function MyClasses() {
  const { data: sessions, isLoading } = useQuery<SessionWithNames[]>({ queryKey: ["/api/students/my-classes"] });

  const now = Date.now();
  const upcoming = sessions?.filter((s) => s.datetime >= now).sort((a, b) => a.datetime - b.datetime) || [];
  const past = sessions?.filter((s) => s.datetime < now).sort((a, b) => b.datetime - a.datetime) || [];

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-8">
      <div className="relative rounded-xl overflow-hidden h-44" data-testid="banner-institute-photo">
        <img
          src={institutePhoto}
          alt="Dr. Perko examining a sample under the microscope in the MAHA Institute lab"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(240_20%_12%/0.82)] via-[hsl(240_20%_14%/0.25)] to-transparent" />
        <div className="relative z-10 h-full flex flex-col justify-end p-4">
          <p className="font-serif text-lg text-[#f5efe4] leading-snug">MAHA Institute</p>
        </div>
      </div>

      <div>
        <h1 className="text-xl font-semibold">My Classes</h1>
        <p className="text-sm text-muted-foreground mt-1">Your enrolled Institute cohort sessions.</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 rounded-lg skeleton-shimmer" />
          <Skeleton className="h-20 rounded-lg skeleton-shimmer" />
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No classes yet" description="You're not enrolled in any cohort yet. Contact the MAHA Institute team." />
      ) : (
        <>
          <SessionGroup title="Upcoming" sessions={upcoming} emptyText="No upcoming classes scheduled." />
          <SessionGroup title="Past" sessions={past} emptyText="No past classes yet." />
        </>
      )}
    </div>
  );
}

function SessionGroup({ title, sessions, emptyText }: { title: string; sessions: SessionWithNames[]; emptyText: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{title}</h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <Card key={s.id} data-testid={`card-session-${s.id}`}>
              <CardContent className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.moduleName} · {s.cohortName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {format(new Date(s.datetime), "EEEE, MMM d, yyyy 'at' HH:mm")}
                </div>
                {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                <Button variant="outline" size="sm" asChild className="self-start mt-1">
                  <a href={s.zoomLink} target="_blank" rel="noopener noreferrer" data-testid={`link-zoom-${s.id}`}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Join Zoom
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
