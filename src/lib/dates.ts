// Calendar-date helpers. A "local date" is a 'YYYY-MM-DD' string in the owner's
// timezone; we never convert it through a UTC midnight Date.

export const DEFAULT_TZ = "Asia/Kolkata";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidLocalDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Today's date in a timezone, e.g. at 2026-01-31T19:00Z Asia/Kolkata gives '2026-02-01'. */
export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function makeDate(y: number, m1: number, d: number): string {
  return `${y}-${pad(m1)}-${pad(d)}`;
}

export function splitDate(s: string): [number, number, number] {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error("Invalid date");
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Adds whole days using pure calendar arithmetic (UTC epoch days, no TZ involved). */
export function addDays(s: string, days: number): string {
  const [y, m, d] = splitDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The cycle start for a given month: the anchor day, clamped to the month's last day. */
export function cycleAnchor(year: number, month1: number, startDay: number): string {
  return makeDate(year, month1, Math.min(startDay, daysInMonth(year, month1)));
}

export type Cycle = { start: string; end: string }; // [start, end)

/**
 * The budget cycle containing `date`, defined as [start, nextStart).
 * startDay is 1..31; e.g. startDay 31 gives Jan 31, Feb 28/29, Mar 31...
 */
export function cycleFor(date: string, startDay: number): Cycle {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 31) throw new Error("startDay must be 1..31");
  const [y, m] = splitDate(date);
  const thisAnchor = cycleAnchor(y, m, startDay);
  let startY = y;
  let startM = m;
  if (date < thisAnchor) {
    startM -= 1;
    if (startM === 0) {
      startM = 12;
      startY -= 1;
    }
  }
  const start = cycleAnchor(startY, startM, startDay);
  let nextY = startY;
  let nextM = startM + 1;
  if (nextM === 13) {
    nextM = 1;
    nextY += 1;
  }
  return { start, end: cycleAnchor(nextY, nextM, startDay) };
}

export function previousCycle(c: Cycle, startDay: number): Cycle {
  return cycleFor(addDays(c.start, -1), startDay);
}

export function nextCycle(c: Cycle, startDay: number): Cycle {
  return cycleFor(c.end, startDay);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(s: string): string {
  const [y, m, d] = splitDate(s);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatCycle(c: Cycle): string {
  const last = addDays(c.end, -1);
  const [y1, m1, d1] = splitDate(c.start);
  const [y2, m2, d2] = splitDate(last);
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}
