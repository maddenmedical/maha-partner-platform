import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { MahaLogo, ThemeToggleIcon } from "@/components/MahaLogo";
import type { Referral, Order } from "@shared/schema";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { InstallAppButton } from "@/components/InstallAppButton";
import {
  UserCheck, Inbox, ShoppingCart, Package, Video, GraduationCap, MessageSquare, Users, LogOut, Megaphone, CalendarClock, UploadCloud, Settings, Contact, ListTodo,
} from "lucide-react";

const navItems = [
  { href: "/admin/approvals", label: "Pending Approvals", icon: UserCheck, testId: "link-admin-approvals" },
  { href: "/admin/referrals", label: "Referrals", icon: Inbox, testId: "link-admin-referrals" },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart, testId: "link-admin-orders" },
  { href: "/admin/products", label: "Products", icon: Package, testId: "link-admin-products" },
  { href: "/admin/videos", label: "Videos", icon: Video, testId: "link-admin-videos" },
  { href: "/admin/institute", label: "Institute", icon: GraduationCap, testId: "link-admin-institute" },
  { href: "/admin/chat", label: "Chat Inbox", icon: MessageSquare, testId: "link-admin-chat" },
  { href: "/admin/todos", label: "To-Dos", icon: ListTodo, testId: "link-admin-todos" },
  { href: "/admin/team", label: "Team", icon: Users, testId: "link-admin-team" },
  { href: "/admin/partners", label: "Partners & Students", icon: Contact, testId: "link-admin-partners" },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone, testId: "link-admin-announcements" },
  { href: "/admin/case-discussions", label: "Case Discussions", icon: CalendarClock, testId: "link-admin-case-discussions" },
  { href: "/admin/migration", label: "Partner Migration", icon: UploadCloud, testId: "link-admin-migration" },
];

function AdminSidebar() {
  const [location] = useLocation();

  // Unread markers (Item 10): a small badge pill per nav item showing what
  // still needs attention. Referrals/orders reuse their existing status
  // field ('New' / 'Requested' = not yet triaged); chat reuses the
  // adminLastReadAt-derived `unread` flag from the threads endpoint.
  const { data: referrals } = useQuery<Referral[]>({ queryKey: ["/api/admin/referrals"], refetchInterval: 15000 });
  const { data: orders } = useQuery<Order[]>({ queryKey: ["/api/admin/orders"], refetchInterval: 15000 });
  const { data: threads } = useQuery<{ unread?: boolean }[]>({ queryKey: ["/api/admin/chat/threads"], refetchInterval: 15000 });

  const badgeCounts: Record<string, number> = {
    "/admin/referrals": referrals?.filter((r) => r.status === "New").length ?? 0,
    "/admin/orders": orders?.filter((o) => o.status === "Requested").length ?? 0,
    "/admin/chat": threads?.filter((t) => t.unread).length ?? 0,
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-2">
          <MahaLogo size={26} className="shrink-0" forceLight />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-semibold text-sidebar-foreground truncate">MAHA Admin</p>
            <p className="text-xs text-sidebar-foreground/60 truncate">Clinic &amp; Institute</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const count = badgeCounts[item.href] ?? 0;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={location.startsWith(item.href)} tooltip={item.label} data-testid={item.testId}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {count > 0 && (
                      <SidebarMenuBadge className="bg-primary text-primary-foreground" data-testid={`badge-unread-${item.testId}`}>
                        {count}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}

export function AdminLayout({ children, title }: { children: ReactNode; title: string }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const style = { "--sidebar-width": "16rem" } as React.CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex h-dvh w-full overflow-hidden">
        <AdminSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <h1 className="text-lg font-semibold truncate" data-testid="text-page-title">{title}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-muted-foreground hidden sm:inline" data-testid="text-current-user">
                {user?.name}
              </span>
              <InstallAppButton />
              <Button variant="ghost" size="icon" asChild aria-label="Account settings" data-testid="button-account">
                <Link href="/admin/account">
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
          <main className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
