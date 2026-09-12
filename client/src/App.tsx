import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import Install from "@/pages/Install";

import { MobileAppLayout, type TabItem } from "@/components/layout/MobileAppLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Home, ClipboardList, ShoppingCart, GraduationCap, FileUp, MessageSquare, CalendarClock } from "lucide-react";

import PartnerHome from "@/pages/partner/PartnerHome";
import ReferPatient from "@/pages/partner/ReferPatient";
import Shop from "@/pages/partner/Shop";
import PartnerVideos from "@/pages/partner/Videos";

import MyClasses from "@/pages/student/MyClasses";
import Homework from "@/pages/student/Homework";

import Chat from "@/pages/Chat";
import Account from "@/pages/Account";

import PendingApprovals from "@/pages/admin/PendingApprovals";
import AdminReferrals from "@/pages/admin/AdminReferrals";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminProducts from "@/pages/admin/AdminProducts";
import AdminVideos from "@/pages/admin/AdminVideos";
import AdminInstitute from "@/pages/admin/AdminInstitute";
import AdminChatInbox from "@/pages/admin/AdminChatInbox";
import AdminTeam from "@/pages/admin/AdminTeam";
import AdminPartners from "@/pages/admin/AdminPartners";
import AdminAnnouncements from "@/pages/admin/AdminAnnouncements";
import AdminCaseDiscussions from "@/pages/admin/AdminCaseDiscussions";
import AdminMigration from "@/pages/admin/AdminMigration";
import AdminTodos from "@/pages/admin/AdminTodos";

import { PushPrompt } from "@/components/PushPrompt";

const partnerTabs: TabItem[] = [
  { href: "/", label: "Home", icon: Home, testId: "tab-home" },
  { href: "/refer", label: "Refer", icon: ClipboardList, testId: "tab-refer" },
  { href: "/shop", label: "Shop", icon: ShoppingCart, testId: "tab-shop" },
  { href: "/videos", label: "Learn", icon: GraduationCap, testId: "tab-education" },
  { href: "/chat", label: "Chat", icon: MessageSquare, testId: "tab-chat" },
];

// A student has everything a partner has (referrals, shop, the paid video
// library) PLUS their own exclusive booked module: live classes and a
// homework upload place that partners never see, even for purchase.
const studentTabs: TabItem[] = [
  { href: "/", label: "Home", icon: Home, testId: "tab-home" },
  { href: "/refer", label: "Refer", icon: ClipboardList, testId: "tab-refer" },
  { href: "/shop", label: "Shop", icon: ShoppingCart, testId: "tab-shop" },
  { href: "/videos", label: "Learn", icon: GraduationCap, testId: "tab-education" },
  { href: "/classes", label: "Classes", icon: CalendarClock, testId: "tab-classes" },
  { href: "/homework", label: "Homework", icon: FileUp, testId: "tab-homework" },
  { href: "/chat", label: "Chat", icon: MessageSquare, testId: "tab-chat" },
];

const ADMIN_TITLES: Record<string, string> = {
  "/admin/approvals": "Pending Approvals",
  "/admin/referrals": "Referrals",
  "/admin/orders": "Orders",
  "/admin/products": "Products",
  "/admin/videos": "Videos",
  "/admin/institute": "Institute",
  "/admin/chat": "Chat Inbox",
  "/admin/team": "Team",
  "/admin/partners": "All Partners",
  "/admin/announcements": "Announcements",
  "/admin/case-discussions": "Case Discussions",
  "/admin/migration": "Partner Migration",
  "/admin/todos": "To-Dos",
};

function PartnerApp() {
  return (
    <MobileAppLayout tabs={partnerTabs} title="MAHA Partner Platform">
      <PushPrompt />
      <Switch>
        <Route path="/" component={PartnerHome} />
        <Route path="/refer" component={ReferPatient} />
        <Route path="/shop" component={Shop} />
        <Route path="/videos" component={PartnerVideos} />
        <Route path="/chat">
          <Chat label="Chat with MAHA Team" />
        </Route>
        <Route path="/account" component={Account} />
        <Route component={NotFound} />
      </Switch>
    </MobileAppLayout>
  );
}

function StudentApp() {
  // Students get the full partner feature set (referrals, shop, the paid video
  // library, case discussions — all rendered inside PartnerHome/ReferPatient/
  // Shop/PartnerVideos, which already branch on role where needed) PLUS their
  // own exclusive booked module: MyClasses and Homework, never shown to a
  // plain partner.
  return (
    <MobileAppLayout tabs={studentTabs} title="MAHA Partner Platform">
      <PushPrompt />
      <Switch>
        <Route path="/" component={PartnerHome} />
        <Route path="/refer" component={ReferPatient} />
        <Route path="/shop" component={Shop} />
        <Route path="/videos" component={PartnerVideos} />
        <Route path="/classes" component={MyClasses} />
        <Route path="/homework" component={Homework} />
        <Route path="/chat">
          <Chat label="Chat with MAHA Team" />
        </Route>
        <Route path="/account" component={Account} />
        <Route component={NotFound} />
      </Switch>
    </MobileAppLayout>
  );
}

function AdminApp() {
  return (
    <Switch>
      <Route path="/admin/approvals">
        <AdminLayout title={ADMIN_TITLES["/admin/approvals"]}><PendingApprovals /></AdminLayout>
      </Route>
      <Route path="/admin/referrals">
        <AdminLayout title={ADMIN_TITLES["/admin/referrals"]}><AdminReferrals /></AdminLayout>
      </Route>
      <Route path="/admin/orders">
        <AdminLayout title={ADMIN_TITLES["/admin/orders"]}><AdminOrders /></AdminLayout>
      </Route>
      <Route path="/admin/products">
        <AdminLayout title={ADMIN_TITLES["/admin/products"]}><AdminProducts /></AdminLayout>
      </Route>
      <Route path="/admin/videos">
        <AdminLayout title={ADMIN_TITLES["/admin/videos"]}><AdminVideos /></AdminLayout>
      </Route>
      <Route path="/admin/institute">
        <AdminLayout title={ADMIN_TITLES["/admin/institute"]}><AdminInstitute /></AdminLayout>
      </Route>
      <Route path="/admin/chat">
        <AdminLayout title={ADMIN_TITLES["/admin/chat"]}><AdminChatInbox /></AdminLayout>
      </Route>
      <Route path="/admin/team">
        <AdminLayout title={ADMIN_TITLES["/admin/team"]}><AdminTeam /></AdminLayout>
      </Route>
      <Route path="/admin/partners">
        <AdminLayout title={ADMIN_TITLES["/admin/partners"]}><AdminPartners /></AdminLayout>
      </Route>
      <Route path="/admin/announcements">
        <AdminLayout title={ADMIN_TITLES["/admin/announcements"]}><AdminAnnouncements /></AdminLayout>
      </Route>
      <Route path="/admin/case-discussions">
        <AdminLayout title={ADMIN_TITLES["/admin/case-discussions"]}><AdminCaseDiscussions /></AdminLayout>
      </Route>
      <Route path="/admin/migration">
        <AdminLayout title={ADMIN_TITLES["/admin/migration"]}><AdminMigration /></AdminLayout>
      </Route>
      <Route path="/admin/todos">
        <AdminLayout title={ADMIN_TITLES["/admin/todos"]}><AdminTodos /></AdminLayout>
      </Route>
      <Route path="/admin/account">
        <AdminLayout title="Account"><Account /></AdminLayout>
      </Route>
      <Route path="/">
        <Redirect to="/admin/approvals" />
      </Route>
      <Route>
        <AdminLayout title="Not Found"><NotFound /></AdminLayout>
      </Route>
    </Switch>
  );
}

function AuthedApp() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "admin") return <AdminApp />;
  if (user.role === "student") return <StudentApp />;
  return <PartnerApp />;
}

function RootRouter() {
  const { user, bootstrapping } = useAuth();

  // While restoring a persisted session on first load, avoid flashing the
  // login screen before we know whether the user is already signed in.
  if (bootstrapping) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="loader-session-restore" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/register" component={Register} />
        <Route component={Login} />
      </Switch>
    );
  }

  return <AuthedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              {/* /install is reachable regardless of auth/bootstrap state — it's the
                  link partners get in onboarding emails, before they ever sign in. */}
              <Switch>
                <Route path="/install/:platform" component={Install} />
                <Route path="/install" component={Install} />
                {/* Reachable regardless of auth/bootstrap state — this link is on the
                    login page and must work even for a signed-out visitor. There is no
                    /reset-password route: password resets are admin-initiated only, see
                    AdminPartners — no self-service reset-link email is sent. */}
                <Route path="/forgot-password" component={ForgotPassword} />
                <Route>
                  <RootRouter />
                </Route>
              </Switch>
            </Router>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
