// Colour tags for people. All keep white initials readable in light and dark mode.
export const PERSON_COLORS = [
  { hex: "#e11d48", name: "Rose" },
  { hex: "#c026d3", name: "Fuchsia" },
  { hex: "#7c3aed", name: "Violet" },
  { hex: "#4f46e5", name: "Indigo" },
  { hex: "#2563eb", name: "Blue" },
  { hex: "#0369a1", name: "Sky" },
  { hex: "#0f766e", name: "Teal" },
  { hex: "#15803d", name: "Green" },
  { hex: "#4d7c0f", name: "Lime" },
  { hex: "#a16207", name: "Amber" },
  { hex: "#c2410c", name: "Orange" },
  { hex: "#475569", name: "Slate" },
] as const;

export const PERSON_COLOR_HEXES: readonly string[] = PERSON_COLORS.map((c) => c.hex);

export function isPersonColor(v: unknown): v is string {
  return typeof v === "string" && PERSON_COLOR_HEXES.includes(v);
}

/** The person's chosen colour, or a stable fallback picked from their id. */
export function personColor(id: string, color?: string | null): string {
  if (isPersonColor(color)) return color;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PERSON_COLOR_HEXES[h % PERSON_COLOR_HEXES.length];
}

/** A colour nobody uses yet if possible (random among the least used), so people look different. */
export function pickNewPersonColor(inUse: (string | null)[]): string {
  const counts = new Map(PERSON_COLOR_HEXES.map((c) => [c, 0]));
  for (const c of inUse) if (c && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  const min = Math.min(...counts.values());
  const options = [...counts].filter(([, n]) => n === min).map(([c]) => c);
  return options[Math.floor(Math.random() * options.length)];
}
