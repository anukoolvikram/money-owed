"use client";
import { useState, useTransition } from "react";
import { updateSettingsAction } from "@/app/actions/ledger";
import { Button, Field, Select, StatusText, TextInput } from "./client";

const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

export function SettingsForm({ initial }: { initial: { timezone: string; cycleStartDay: number; theme: "system" | "light" | "dark" } }) {
  const [tz, setTz] = useState(initial.timezone);
  const [day, setDay] = useState(String(initial.cycleStartDay));
  const [theme, setTheme] = useState(initial.theme);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); start(async () => {
      const r = await updateSettingsAction({ timezone: tz, cycleStartDay: day, theme });
      setErrors(r.ok ? {} : r.fieldErrors ?? {});
      setStatus(r.ok ? { tone: "ok", text: "Settings saved." } : { tone: "error", text: r.message });
      if (r.ok) document.documentElement.dataset.theme = theme === "system" ? "" : theme;
    }); }}>
      <Field label="Timezone" htmlFor="s-tz" error={errors.timezone} hint="Used for “today” and budget cycles.">
        <Select id="s-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {(ZONES.includes(tz) ? ZONES : [tz, ...ZONES]).map((z) => <option key={z} value={z}>{z}</option>)}
        </Select>
      </Field>
      <Field label="Budget cycle starts on day" htmlFor="s-day" error={errors.cycleStartDay} hint="1 to 31, e.g. your salary day. In shorter months a late day moves to the month’s last day.">
        <TextInput id="s-day" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} error={errors.cycleStartDay} />
      </Field>
      <Field label="Theme" htmlFor="s-theme">
        <Select id="s-theme" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
          <option value="system">Match device</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </Field>
      <p className="text-xs text-muted">Changing the start day does not move budgets you already set; they stay attached to their original dates.</p>
      <StatusText status={status} />
      <Button type="submit" pending={pending} className="w-full">Save settings</Button>
    </form>
  );
}
