import { Spinner } from "@/components/ui";

// Shown while a page in the app is loading or being refreshed after navigation.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-accent">
      <Spinner size={40} label="Loading" />
    </div>
  );
}
