import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { setAuthToken, apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

export type AuthUser = {
  id: number;
  role: "partner" | "student" | "admin";
  name: string;
  email: string;
  status: string;
};

type PendingState = { pending: true; status: "pending" | "rejected" } | null;

interface AuthContextValue {
  user: AuthUser | null;
  pendingState: PendingState;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  clearPending: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pendingState, setPendingState] = useState<PendingState>(null);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setPendingState(null);
    try {
      const res = await fetch(
        `${"__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__"}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      setAuthToken(data.token);
      setUser(data.user);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    queryClient.clear();
  }, []);

  const clearPending = useCallback(() => setPendingState(null), []);

  return (
    <AuthContext.Provider value={{ user, pendingState, loading, login, logout, clearPending }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
