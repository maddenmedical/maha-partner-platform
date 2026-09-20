import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { MahaLogo, ThemeToggleIcon } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { InstallAppButton } from "@/components/InstallAppButton";
import { LogOut, Settings, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface TabItem {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
}

export function MobileAppLayout({ children, tabs, title }: { children: ReactNode; tabs: TabItem[]; title: string }) {
  const [location] = useLocation();
  const { user, logout, exitImpersonation } = useAuth();
  const { theme, toggle } = useTheme();

  // When there are more tabs than fit (the scrollable-row case below), the
  // active tab can start off partially or fully scrolled out of view --
  // e.g. landing on the last tab right after adding a 6th one. Nudge it
  // into view on mount/navigation so the current section is never clipped.
  const activeTabRef = useState<{ current: HTMLAnchorElement | null }>(() => ({ current: null }))[0];
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [location]);

  // Unread marker: a numeric badge on the merged Chat tab combining the
  // private Inbox (MAHA team) and the public Community. `/api/chat/threads`
  // only exposes a boolean unread flag per thread, so we count how many
  // threads have unread admin messages and add the Community unread count.
  // Shares the same query/cache the Chat and Community pages themselves
  // use, so this adds no extra load. Display is capped at "9+" to keep the
  // badge small on the bottom-nav icon.
  const { data: chatThreads } = useQuery<{ unread?: boolean }[]>({ queryKey: ["/api/chat/threads"], refetchInterval: 15000 });
  const unreadChatCount = chatThreads?.filter((t) => t.unread).length ?? 0;
  const { data: communityUnread } = useQuery<{ count: number }>({ queryKey: ["/api/community/unread-count"], refetchInterval: 15000 });
  const unreadCommunityCount = communityUnread?.count ?? 0;
  const unreadChatTabCount = unreadChatCount + unreadCommunityCount;
  const unreadChatTabLabel = unreadChatTabCount > 9 ? "9+" : String(unreadChatTabCount);

  // Track an in-app navigation stack (not just sub-pages) so the back arrow
  // shows whenever there's a real "previous page" to return to — including
  // between tab pages (e.g. Refer -> Shop) — and hides only when the current
  // page is the first one visited this session (nothing to go back to).
  const [stack, setStack] = useState<string[]>([location]);
  useEffect(() => {
    setStack((prev) => {
      const current = prev[prev.length - 1];
      if (location === current) return prev;
      const previous = prev[prev.length - 2];
      if (previous !== undefined && previous === location) {
        // Back navigation (browser back or our own button) — pop the stack.
        return prev.slice(0, -1);
      }
      return [...prev, location];
    });
  }, [location]);
  const canGoBack = stack.length > 1;

  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden">
      {user?.impersonating && (
        <div
          className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200"
          data-testid="banner-impersonating"
        >
          <span className="text-xs leading-tight">
            Viewing as <strong>{user?.name}</strong> ({user?.role})
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs shrink-0 border-amber-500/40"
            onClick={exitImpersonation}
            data-testid="button-exit-impersonation"
          >
            Exit to Admin
          </Button>
        </div>
      )}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack ? (
            <button
              type="button"
              onClick={() => window.history.back()}
              aria-label="Go back"
              data-testid="button-back"
              className="h-9 w-9 -ml-1 flex items-center justify-center rounded-md hover-elevate active-elevate-2 text-foreground shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <MahaLogo size={26} className="text-primary shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{title}</p>
            <p className="text-xs text-muted-foreground leading-tight truncate" data-testid="text-current-user">
              {user?.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <InstallAppButton />
          <Button variant="ghost" size="icon" asChild aria-label="Account settings" data-testid="button-account">
            <Link href="/account">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <button
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="h-9 w-9 flex items-center justify-center rounded-md hover-elevate active-elevate-2 text-muted-foreground"
            data-testid="button-theme-toggle"
          >
            <ThemeToggleIcon dark={theme === "dark"} />
          </button>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out" data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-24">{children}</main>

      {/* Wide roles (e.g. a student who also has partner functions) get more
          tabs than comfortably fit an equal-width grid on a phone screen, so
          switch to a horizontally scrollable row instead of squeezing labels. */}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-card md:hidden",
          tabs.length > 5 ? "flex overflow-x-auto no-scrollbar" : "grid"
        )}
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          ...(tabs.length > 5 ? {} : { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }),
        }}
        aria-label="Primary"
      >
        {tabs.map((tab) => {
          const active = location === tab.href || (tab.href !== "/" && location.startsWith(tab.href));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              ref={active ? activeTabRef : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium hover-elevate active-elevate-2",
                tabs.length > 5 ? "min-w-[4.25rem] flex-1" : "",
                active ? "text-primary" : "text-muted-foreground"
              )}
              data-testid={tab.testId}
            >
              <span className="relative">
                <tab.icon className="h-5 w-5" />
                {tab.href === "/chat" && unreadChatTabCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2 min-w-[1rem] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 font-semibold text-center"
                    aria-label={`${unreadChatTabCount} unread`}
                    data-testid="indicator-unread-chat-tab"
                  >
                    {unreadChatTabLabel}
                  </span>
                )}
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden md:flex fixed bottom-0 left-0 right-0 z-10 justify-center border-t border-border bg-card">
        <div className="flex max-w-2xl w-full">
          {tabs.map((tab) => {
            const active = location === tab.href || (tab.href !== "/" && location.startsWith(tab.href));
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium hover-elevate active-elevate-2",
                  active ? "text-primary" : "text-muted-foreground"
                )}
                data-testid={`${tab.testId}-desktop`}
              >
                <span className="relative">
                  <tab.icon className="h-5 w-5" />
                  {tab.href === "/chat" && unreadChatTabCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 min-w-[1rem] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 font-semibold text-center"
                      aria-label={`${unreadChatTabCount} unread`}
                      data-testid="indicator-unread-chat-tab-desktop"
                    >
                      {unreadChatTabLabel}
                    </span>
                  )}
                </span>
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
