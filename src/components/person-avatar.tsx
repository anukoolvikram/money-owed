import { personColor } from "@/lib/person-color";
import { cx } from "./ui";

export function PersonAvatar({ id, name, color, size = "md" }: { id: string; name: string; color?: string | null; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: personColor(id, color) }}
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full font-semibold uppercase text-white",
        size === "lg" ? "h-14 w-14 text-2xl" : "h-10 w-10 text-base",
      )}
    >
      {[...name.trim()][0] ?? "?"}
    </span>
  );
}
