// Server-safe presentational primitives (no client state).
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatINR } from "@/lib/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, back, action, subtitle }: { title: string; back?: string; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-2xl items-center gap-2 px-4">
        {back && (
          <Link href={back} className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-2xl text-muted hover:bg-surface-2" aria-label="Back">
            <span aria-hidden>‹</span>
          </Link>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function Card({ className, ...p }: ComponentProps<"section">) {
  return <section className={cx("rounded-2xl border border-line bg-surface p-4", className)} {...p} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

/** Amount with optional sign. Direction is always shown in text/sign, not only colour. */
export function Money({ paise, sign, className, tone }: { paise: string | bigint; sign?: "auto" | "always" | "never"; className?: string; tone?: "in" | "out" | "neutral" }) {
  const v = typeof paise === "bigint" ? paise : BigInt(paise);
  const color = tone === "in" ? "text-in" : tone === "out" ? "text-out" : "";
  return <span className={cx("num whitespace-nowrap", color, className)}>{formatINR(v, { sign })}</span>;
}

export function LinkButton({ href, children, variant = "primary", className, ...rest }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string } & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  return (
    <Link href={href} className={cx(buttonClass(variant), className)} {...rest}>
      {children}
    </Link>
  );
}

export function buttonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "primary", size: "md" | "lg" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    size === "lg" ? "min-h-13 px-5 text-base" : "min-h-11 px-4 text-[15px]",
    variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
    variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
    variant === "ghost" && "text-accent hover:bg-accent-soft",
    variant === "danger" && "border border-danger/40 bg-danger-soft text-danger hover:opacity-90",
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "danger"; children: ReactNode; title?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "rounded-xl border px-3 py-2 text-sm",
        tone === "info" && "border-line bg-surface-2",
        tone === "warn" && "border-warn/40 bg-warn-soft text-ink",
        tone === "danger" && "border-danger/40 bg-danger-soft text-ink",
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "accent" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "accent" && "bg-accent-soft text-accent",
      )}
    >
      {children}
    </span>
  );
}

export function Main({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cx("mx-auto w-full max-w-2xl px-4 pb-32 pt-4", className)}>{children}</main>;
}
