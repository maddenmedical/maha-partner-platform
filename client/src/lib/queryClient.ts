import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// The session lives in an httpOnly cookie set by the server (see
// server/routes.ts), not in JS-readable storage. This means a login survives
// page reloads and re-opening the installed app for up to the 90-day
// server-side session window, without touching localStorage/sessionStorage
// (unavailable in the sandboxed preview iframe, and not appropriate for auth
// tokens anyway). `credentials: "include"` ensures the cookie is sent on
// every request.

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText;
    // Read the body as text ONCE (Response bodies can only be consumed a
    // single time — calling .json() and then .text() on failure throws
    // "body stream already read" and hides the real error from the user).
    const raw = await res.text().catch(() => "");
    if (raw) {
      try {
        const data = JSON.parse(raw);
        message = data.message || message;
      } catch {
        message = raw;
      }
    }
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  isFormData = false,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data && !isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    credentials: "include",
    body: isFormData ? (data as FormData) : data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { credentials: "include" });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
