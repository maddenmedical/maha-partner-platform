import { useEffect, useState } from "react";

// Tracks an in-app navigation stack (not just sub-pages) so a back button
// can show whenever there's a real "previous page" to return to --
// including between top-level sections -- and hide only when the current
// page is the first one visited this session (nothing to go back to).
// Shared by MobileAppLayout (partner/student) and AdminLayout so both
// back buttons behave identically.
export function useCanGoBack(location: string): boolean {
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
  return stack.length > 1;
}
