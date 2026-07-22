import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { MahaLogo, ThemeToggleIcon } from "@/components/MahaLogo";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
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
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <MahaLogo size={26} className="text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{title}</p>
            <p className="text-xs text-muted-foreground leading-tight truncate" data-testid="text-current-user">
              {user?.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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

      <main className="flex-1 overflow-y-auto pb-20 md:pb-6">{children}</main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-10 grid border-t border-border bg-card md:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        aria-label="Primary"
      >
        {tabs.map((tab) => {
          const active = location === tab.href || (tab.href !== "/" && location.startsWith(tab.href));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium hover-elevate active-elevate-2",
                active ? "text-primary" : "text-muted-foreground"
              )}
              data-testid={tab.testId}
            >
              <tab.icon className="h-5 w-5" />
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
                <tab.icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
