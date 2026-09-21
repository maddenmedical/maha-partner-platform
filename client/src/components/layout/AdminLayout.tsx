import { ReactNode, useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { apiRequest } from "@/lib/queryClient";
import { MahaLogo, ThemeToggleIcon } from "@/components/MahaLogo";
import type { Referral, Order, User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { InstallAppButton } from "@/components/InstallAppButton";
import {
  Home, UserCheck, Inbox, ShoppingCart, Package, Video, GraduationCap, MessageSquare, Users, Users2, LogOut, Megaphone, CalendarClock, UploadCloud, Settings, Contact, ListTodo, GripVertical, Building2, Eye, Loader2,
} from "lucide-react";

const navItems = [
  { href: "/admin/home", label: "Home", icon: Home, testId: "link-admin-home" },
  { href: "/admin/approvals", label: "Pending Approvals", icon: UserCheck, testId: "link-admin-approvals" },
  { href: "/admin/referrals", label: "Referrals", icon: Inbox, testId: "link-admin-referrals" },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart, testId: "link-admin-orders" },
  { href: "/admin/products", label: "Products", icon: Package, testId: "link-admin-products" },
  { href: "/admin/videos", label: "Videos", icon: Video, testId: "link-admin-videos" },
  { href: "/admin/institute", label: "Institute", icon: GraduationCap, testId: "link-admin-institute" },
  { href: "/admin/chat", label: "Chat Inbox", icon: MessageSquare, testId: "link-admin-chat" },
  { href: "/admin/community", label: "Community", icon: Users2, testId: "link-admin-community" },
  { href: "/admin/todos", label: "To-Dos", icon: ListTodo, testId: "link-admin-todos" },
  { href: "/admin/team", label: "Team", icon: Users, testId: "link-admin-team" },
  { href: "/admin/partners", label: "Partners & Students", icon: Contact, testId: "link-admin-partners" },
  { href: "/admin/clinics", label: "Clinics", icon: Building2, testId: "link-admin-clinics" },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone, testId: "link-admin-announcements" },
  { href: "/admin/case-discussions", label: "Events", icon: CalendarClock, testId: "link-admin-case-discussions" },
  { href: "/admin/migration", label: "Partner Migration", icon: UploadCloud, testId: "link-admin-migration" },
];
const DEFAULT_ORDER = navItems.map((i) => i.href);

// One draggable row. The grip handle is the only drag surface (via
// dnd-kit's listeners/attributes) so the rest of the row still behaves like
// a normal link — click-to-navigate keeps working during and after reorders.
function SortableNavItem({
  item, isActive, count,
}: {
  item: (typeof navItems)[number];
  isActive: boolean;
  count: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href });
  const { isMobile, setOpenMobile } = useSidebar();
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className="group/menu-item relative flex items-center gap-0"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab active:cursor-grabbing touch-none px-1 text-sidebar-foreground/30 hover:text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden"
        aria-label={`Reorder ${item.label}`}
        data-testid={`handle-reorder-${item.testId}`}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} data-testid={item.testId} className="min-w-0">
        {/* On mobile the sidebar is a slide-over sheet — tapping a destination
            should feel like navigating to a new screen, not leave the drawer
            hanging open behind it, so close it on tap instead of requiring
            an extra manual swipe-to-dismiss. */}
        <Link href={item.href} onClick={() => isMobile && setOpenMobile(false)}>
          <item.icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {count > 0 && (
        <SidebarMenuBadge className="bg-primary text-primary-foreground" data-testid={`badge-unread-${item.testId}`}>
          {count}
        </SidebarMenuBadge>
      )}
    </li>
  );
}

function AdminSidebar() {
  const [location] = useLocation();
  const { user, updateUser, viewAsMember } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: pinnedMembers } = useQuery<User[]>({ queryKey: ["/api/admin/pinned-members"] });
  const [viewAsPending, setViewAsPending] = useState<number | null>(null);

  async function handleSidebarViewAs(id: number) {
    setViewAsPending(id);
    try {
      await viewAsMember(id);
      // Impersonation swaps the whole app into the partner/student view, so
      // the admin drawer is about to be gone anyway — but close it explicitly
      // rather than leaving a stale open flag for whenever they return.
      if (isMobile) setOpenMobile(false);
    } catch (err: any) {
      toast({ title: "Could not view as this member", description: err.message, variant: "destructive" });
    } finally {
      setViewAsPending(null);
    }
  }

  // Unread markers (Item 10): a small badge pill per nav item showing what
  // still needs attention. Referrals/orders reuse their existing status
  // field ('New' / 'Requested' = not yet triaged); chat reuses the
  // adminLastReadAt-derived `unread` flag from the threads endpoint.
  const { data: referrals } = useQuery<Referral[]>({ queryKey: ["/api/admin/referrals"], refetchInterval: 15000 });
  const { data: orders } = useQuery<Order[]>({ queryKey: ["/api/admin/orders"], refetchInterval: 15000 });
  const { data: threads } = useQuery<{ unread?: boolean }[]>({ queryKey: ["/api/admin/chat/threads"], refetchInterval: 15000 });
  const { data: communityUnread } = useQuery<{ count: number }>({ queryKey: ["/api/community/unread-count"], refetchInterval: 15000 });

  const badgeCounts: Record<string, number> = {
    "/admin/referrals": referrals?.filter((r) => r.status === "New").length ?? 0,
    "/admin/orders": orders?.filter((o) => o.status === "Requested").length ?? 0,
    "/admin/chat": threads?.filter((t) => t.unread).length ?? 0,
    "/admin/community": communityUnread?.count ?? 0,
  };

  // Saved order is a JSON array of hrefs on the admin's own account, so it
  // follows them across devices/sessions. Filter out any stale hrefs (a nav
  // item that no longer exists) and append any new items the admin hasn't
  // placed yet, so future additions to `navItems` always show up.
  const savedOrder = useMemo<string[]>(() => {
    if (!user?.adminNavOrder) return DEFAULT_ORDER;
    try {
      const parsed = JSON.parse(user.adminNavOrder);
      if (!Array.isArray(parsed)) return DEFAULT_ORDER;
      const known = new Set(DEFAULT_ORDER);
      const cleaned = parsed.filter((h) => known.has(h));
      const missing = DEFAULT_ORDER.filter((h) => !cleaned.includes(h));
      return [...cleaned, ...missing];
    } catch {
      return DEFAULT_ORDER;
    }
  }, [user?.adminNavOrder]);

  const [order, setOrder] = useState<string[]>(savedOrder);
  useEffect(() => setOrder(savedOrder), [savedOrder]);

  const saveOrderMutation = useMutation({
    mutationFn: (newOrder: string[]) => apiRequest("PATCH", "/api/admin/nav-order", { order: newOrder }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const orderedItems = order.map((href) => navItems.find((i) => i.href === href)).filter((i): i is (typeof navItems)[number] => !!i);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(order, oldIndex, newIndex);
    setOrder(newOrder);
    updateUser({ adminNavOrder: JSON.stringify(newOrder) });
    saveOrderMutation.mutate(newOrder, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }),
    });
  }

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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <SidebarMenu>
                  {orderedItems.map((item) => (
                    <SortableNavItem
                      key={item.href}
                      item={item}
                      isActive={location.startsWith(item.href)}
                      count={badgeCounts[item.href] ?? 0}
                    />
                  ))}
                </SidebarMenu>
              </SortableContext>
            </DndContext>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {pinnedMembers && pinnedMembers.length > 0 && (
        <SidebarFooter className="gap-1 group-data-[collapsible=icon]:hidden">
          <p className="px-2 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wide">View as</p>
          <SidebarMenu>
            {pinnedMembers.map((m) => (
              <SidebarMenuItem key={m.id}>
                <SidebarMenuButton
                  onClick={() => handleSidebarViewAs(m.id)}
                  disabled={viewAsPending === m.id}
                  tooltip={`View as ${m.name}`}
                  data-testid={`button-sidebar-view-as-${m.id}`}
                  className="min-w-0"
                >
                  {viewAsPending === m.id ? <Loader2 className="animate-spin" /> : <Eye />}
                  <span className="truncate">{m.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarFooter>
      )}
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
