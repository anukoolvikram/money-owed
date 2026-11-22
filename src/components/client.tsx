"use client";
// Small client-side building blocks: fields, pending buttons, confirm dialog.
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { buttonClass, cx } from "./ui";

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && (
        <p className="text-sm text-danger" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "block w-full min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-muted/70 aria-[invalid=true]:border-danger";

export function TextInput({ error, className, ...p }: ComponentProps<"input"> & { error?: string }) {
  return (
    <input
      {...p}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${p.id}-error` : p["aria-describedby"]}
      className={cx(inputClass, className)}
    />
  );
}

export function Select({ error, className, children, ...p }: ComponentProps<"select"> & { error?: string }) {
  return (
    <select
      {...p}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${p.id}-error` : undefined}
      className={cx(inputClass, "appearance-auto", className)}
    >
      {children}
    </select>
  );
}

export function Button({
  pending,
  variant = "primary",
  size = "md",
  className,
  children,
  ...p
}: ComponentProps<"button"> & { pending?: boolean; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "lg" }) {
  return (
    <button {...p} disabled={p.disabled || pending} aria-busy={pending || undefined} className={cx(buttonClass(variant, size), className)}>
      {pending ? <span>Saving…</span> : children}
    </button>
  );
}

/** Accessible modal confirmation using the native <dialog> element. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
  pending,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  pending?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-[15px] text-ink">{children}</div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm} pending={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

export function StatusText({ status }: { status: { tone: "ok" | "error"; text: string } | null }) {
  return (
    <p aria-live="polite" role="status" className={cx("min-h-5 text-sm", status?.tone === "error" ? "text-danger" : "text-in")}>
      {status?.text ?? ""}
    </p>
  );
}
