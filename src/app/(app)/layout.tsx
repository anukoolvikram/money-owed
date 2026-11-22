import { requireOwnerPage } from "@/server/auth/guard";
import { BottomNav, SessionGuard } from "@/components/bottom-nav";

// Every page in this group is private and rendered per request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return (
    <>
      <SessionGuard />
      {children}
      <BottomNav />
    </>
  );
}
