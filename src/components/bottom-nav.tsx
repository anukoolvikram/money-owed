"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { House, List, Plus, Users, Menu } from "lucide-react";
import { cx } from "./ui";

const items = [
  { href: "/", label: "Overview", icon: House, match: (p: string) => p === "/" },
  { href: "/transactions", label: "Entries", icon: List, match: (p: string) => p.startsWith("/transactions") },
  { href: "/add", label: "Add", icon: Plus, match: (p: string) => p.startsWith("/add"), primary: true },
  { href: "/people", label: "People", icon: Users, match: (p: string) => p.startsWith("/people") },
  { href: "/more", label: "More", icon: Menu, match: (p: string) => p.startsWith("/more") },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
      <ul className="mx-auto grid max-w-2xl grid-cols-5">
        {items.map(({ href, label, icon: Icon, match, primary }) => {
          const active = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs",
                  active ? "font-semibold text-accent" : "text-muted",
                )}
              >
                {primary ? (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm">
                    <Icon size={24} aria-hidden />
                  </span>
                ) : (
                  <Icon size={22} aria-hidden />
                )}
                <span className={primary ? "sr-only" : undefined}>{label === "Add" ? "Add entry" : label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * If the browser restores a private page from the back/forward cache (for
 * example after logout), reload it so the server re-checks the session.
 */
export function SessionGuard() {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return null;
}
