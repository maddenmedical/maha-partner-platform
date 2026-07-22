import { useTheme } from "@/context/ThemeContext";
import markBrown from "@/assets/maha-mark-brown.png";
import markLight from "@/assets/maha-mark-light.png";
import wordmarkDark from "@/assets/maha-logo-full.png";
import wordmarkLight from "@/assets/maha-logo-full-light.png";

/**
 * Official MAHA brand mark and lockup.
 * - MahaLogo: mark-only (brown/light), for compact contexts (sidebar, mobile header).
 * - MahaWordmark: full lockup (mark + "MAHA" serif wordmark), for login/register hero placement.
 * Swaps to a light variant in dark mode so the mark stays visible on dark surfaces.
 * Assets are imported as ES modules (not referenced from /public) so Vite rewrites
 * their URLs correctly under the relative `base: "./"` build used for deployment.
 */
export function MahaLogo({
  className = "",
  size = 32,
  forceLight = false,
}: {
  className?: string;
  size?: number;
  forceLight?: boolean;
}) {
  const { theme } = useTheme();
  const src = forceLight || theme === "dark" ? markLight : markBrown;
  return (
    <img
      src={src}
      alt="MAHA"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

export function MahaWordmark({ className = "", width = 160 }: { className?: string; width?: number }) {
  const { theme } = useTheme();
  const src = theme === "dark" ? wordmarkLight : wordmarkDark;
  return (
    <img
      src={src}
      alt="MAHA"
      width={width}
      className={className}
      style={{ width, height: "auto", objectFit: "contain" }}
    />
  );
}

export function ThemeToggleIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
