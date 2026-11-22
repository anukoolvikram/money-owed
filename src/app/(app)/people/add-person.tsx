"use client";
import { useState } from "react";
import { PersonForm } from "@/components/person-form";
import { Button } from "@/components/client";

export function AddPersonPanel({ today, startOpen }: { today: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!open) return <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>+ Add person</Button>;
  return (
    <section aria-label="Add person" className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 font-semibold">Add person</h2>
      <PersonForm today={today} />
    </section>
  );
}
