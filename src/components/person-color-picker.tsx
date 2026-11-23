"use client";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { setPersonColorAction } from "@/app/actions/ledger";
import { PERSON_COLORS } from "@/lib/person-color";
import { cx, Spinner } from "./ui";
import { useFresh } from "./fresh-data";

/** Row of colour swatches; tapping one changes the person's colour tag. */
export function PersonColorPicker({ id, current }: { id: string; current: string }) {
  const [selected, setSelected] = useState(current);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const fresh = useFresh();

  function choose(hex: string) {
    if (hex === selected || saving) return;
    const previous = selected;
    setSelected(hex); // show the choice straight away
    setSaving(hex);
    setError(null);
    const shown = fresh.begin();
    start(async () => {
      try {
        const res = await setPersonColorAction({ id, color: hex });
        if (res.ok) await shown();
        else {
          setSelected(previous);
          setError(res.message);
        }
      } catch {
        setSelected(previous);
        setError("Could not reach the server. Try again.");
      } finally {
        setSaving(null);
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour tag">
        {PERSON_COLORS.map((c) => {
          const on = c.hex === selected;
          return (
            <button
              key={c.hex}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.name}
              title={c.name}
              onClick={() => choose(c.hex)}
              style={{ backgroundColor: c.hex }}
              className={cx("flex h-9 w-9 items-center justify-center rounded-full text-white", on && "ring-2 ring-ink ring-offset-2 ring-offset-surface")}
            >
              {saving === c.hex ? <Spinner size={16} /> : on ? <Check size={18} aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
