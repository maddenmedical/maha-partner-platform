import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// Deterministic color per person (hashed from their name) so the same
// person's initials avatar always looks the same across chat and admin
// lists, without needing to store a color on the user row.
const PALETTE = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-lime-600",
  "bg-emerald-500", "bg-teal-500", "bg-cyan-500", "bg-blue-500",
  "bg-violet-500", "bg-fuchsia-500",
];

function colorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initialsForName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZE_CLASSES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-16 w-16 text-lg",
} as const;

interface UserAvatarProps {
  photoUrl?: string | null;
  name: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

// Shared avatar used in chat message bubbles, the admin partner/student
// list, and the admin team list — shows the uploaded photo when present,
// otherwise falls back to a colored circle with the person's initials.
export function UserAvatar({ photoUrl, name, size = "md", className }: UserAvatarProps) {
  const safeName = name || "?";
  return (
    <Avatar className={cn(SIZE_CLASSES[size], "shrink-0", className)} data-testid={`avatar-${safeName.replace(/\s+/g, "-").toLowerCase()}`}>
      {photoUrl && <AvatarImage src={photoUrl} alt={safeName} />}
      <AvatarFallback className={cn(colorForName(safeName), "text-white font-medium")}>
        {initialsForName(safeName)}
      </AvatarFallback>
    </Avatar>
  );
}
