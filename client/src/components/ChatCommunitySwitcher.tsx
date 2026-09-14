import { Link } from "wouter";
import { Inbox, Users2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Small segmented control that lets partners/students move between the two
// sub-sections merged under the single bottom-nav "Chat" tab: their private
// Inbox (1:1 with the MAHA team) and the public Community. Each page (Chat,
// Community) renders this in its own header and reports its own unread
// state plus the *other* section's, so a dot can appear on whichever side
// you're not currently looking at.
export function ChatCommunitySwitcher({
  active,
  hasUnreadInbox,
  hasUnreadCommunity,
}: {
  active: "inbox" | "community";
  hasUnreadInbox?: boolean;
  hasUnreadCommunity?: boolean;
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-card-border bg-muted/40 p-0.5 gap-0.5 self-start"
      role="tablist"
      aria-label="Chat section"
      data-testid="chat-community-switcher"
    >
      <Link
        href="/chat"
        role="tab"
        aria-selected={active === "inbox"}
        className={cn(
          "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium hover-elevate active-elevate-2",
          active === "inbox" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
        )}
        data-testid="switcher-tab-inbox"
      >
        <Inbox className="h-3.5 w-3.5" />
        Inbox
        {hasUnreadInbox && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary" data-testid="indicator-unread-inbox-switcher" />
        )}
      </Link>
      <Link
        href="/chat/community"
        role="tab"
        aria-selected={active === "community"}
        className={cn(
          "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium hover-elevate active-elevate-2",
          active === "community" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
        )}
        data-testid="switcher-tab-community"
      >
        <Users2 className="h-3.5 w-3.5" />
        Community
        {hasUnreadCommunity && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary" data-testid="indicator-unread-community-switcher" />
        )}
      </Link>
    </div>
  );
}
