import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { navigate } from "wouter/use-hash-location";

export type AuthUser = {
  id: number;
  role: "partner" | "student" | "admin";
  name: string;
  email: string;
  status: string;
  installBannerDismissedAt: number | null;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  suffix: string | null;
  username: string | null;
  phone: string | null;
  businessName: string | null;
  vatNumber: string | null;
  profession: string | null;
  homepageUrl: string | null;
  degreeFileUrl: string | null;
  photoUrl: string | null;
  city: string | null;
  address: string | null;
  country: string | null;
  legalAcceptedVersion: string | null;
  adminNavOrder: string | null;
  // Set only while an admin is using "View Platform as Member" -- who the
  // real admin behind this session is, so the app can show a persistent
  // banner and offer a way back. Absent/null for every normal login.
  impersonating?: { adminId: number; adminName: string } | null;
};

type PendingState = { pending: true; status: "pending" | "rejected" } | null;

interface AuthContextValue {
  user: AuthUser | null;
  pendingState: PendingState;
  loading: boolean;
  // True only during the initial app load while we try to restore a
  // previously persisted session; distinct from `loading`, which reflects an
  // in-flight login submission.
  bootstrapping: boolean;
  login: (email: string, password: string) => Promise<void>;
  // Used by the Face ID / Fingerprint (WebAuthn) login flow, which resolves
  // its own user via a separate verify call (the server sets the session
  // cookie on that response) rather than the email/password endpoint.
  loginWithUser: (authUser: AuthUser) => void;
  logout: () => Promise<void>;
  // Admin-only: become a specific partner/student for real (fully
  // functional), on this same session/cookie.
  viewAsMember: (userId: number) => Promise<void>;
  // Restores the admin's own identity on this session.
  exitImpersonation: () => Promise<void>;
  clearPending: () => void;
  markInstallBannerDismissed: () => void;
  // Merge a fresh copy of the user (e.g. after a profile edit save) into
  // the cached auth state so the header/greeting/etc. update immediately
  // without a full page reload.
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pendingState, setPendingState] = useState<PendingState>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);

  // On first load, check whether a session cookie survived from a previous
  // visit (the cookie itself is httpOnly and invisible to JS, so we always
  // just ask the server). The server session lasts 90 days and slides
  // forward on use, so this effectively keeps active users signed in
  // indefinitely without ever touching client-side storage.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/me");
        const authUser = await res.json();
        setUser(authUser);
        // Guard against a stale bookmarked/shared "/register" link opened by
        // a browser that already has a valid session — that path only exists
        // in the logged-out shell and would otherwise 404 in the app shell.
        if (location.hash.replace(/^#\/?/, "") === "register") {
          navigate("/", { replace: true });
        }
      } catch {
        // No valid session cookie — fall back to the login screen.
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setPendingState(null);
    try {
      const res = await fetch(
        `${"__PORT_5001__".startsWith("__") ? "" : "__PORT_5001__"}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.status) {
          setPendingState({ pending: true, status: data.status });
          return;
        }
        throw new Error(data.message || "Login failed");
      }
      setUser(data.user);
      // The hash location (e.g. "/register" if the visitor was on the sign-up
      // page, or a stale deep link from a previous session) may not exist as a
      // route in the freshly-mounted role-specific app shell. Reset to the
      // home tab so a successful login never lands on a 404.
      navigate("/", { replace: true });
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithUser = useCallback((authUser: AuthUser) => {
    setPendingState(null);
    setUser(authUser);
    navigate("/", { replace: true });
  }, []);

  const viewAsMember = useCallback(async (userId: number) => {
    const res = await apiRequest("POST", `/api/admin/impersonate/${userId}`);
    const data = await res.json();
    // Cached queries (referrals, orders, chat threads, etc.) are keyed by
    // path only, not by user id -- they rely entirely on the session cookie
    // to know "whose data". Without clearing, the member's view would open
    // showing whatever the admin had cached a moment ago.
    queryClient.clear();
    setUser({ ...data.user, impersonating: data.impersonating });
    navigate("/", { replace: true });
  }, []);

  const exitImpersonation = useCallback(async () => {
    const res = await apiRequest("POST", "/api/admin/impersonate/exit");
    const data = await res.json();
    queryClient.clear();
    setUser(data.user);
    navigate("/admin/partners", { replace: true });
  }, []);

  const logout = useCallback(async () => {
    // Guard against the header's normal logout button accidentally ending
    // the admin's own login while mid "View as member" -- redirect to
    // exiting the impersonation instead, which is almost certainly what was
    // meant; the real admin login stays intact.
    if (user?.impersonating) {
      await exitImpersonation();
      return;
    }
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // Even if the request fails, still clear local state below.
    }
    setUser(null);
    queryClient.clear();
    // Reset location too, so signing back in (possibly as a different role)
    // never inherits a hash path that belongs to the previous role's shell.
    navigate("/", { replace: true });
  }, [user?.impersonating, exitImpersonation]);

  const clearPending = useCallback(() => setPendingState(null), []);

  const markInstallBannerDismissed = useCallback(() => {
    setUser((prev) => (prev ? { ...prev, installBannerDismissedAt: Date.now() } : prev));
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, pendingState, loading, bootstrapping, login, loginWithUser, logout, viewAsMember, exitImpersonation, clearPending, markInstallBannerDismissed, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
