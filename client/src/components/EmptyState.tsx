import { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-16 text-muted-foreground">
      <Icon className="h-10 w-10 mb-4 text-muted-foreground/60" />
      <h3 className="text-base font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm max-w-xs mb-5">{description}</p>
      {action}
    </div>
  );
}
