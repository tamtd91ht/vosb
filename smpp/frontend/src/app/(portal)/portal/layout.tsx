import { PortalSidebar } from "@/components/layout/PortalSidebar";
import { PortalTopbar } from "@/components/layout/PortalTopbar";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARTNER") {
    redirect("/login");
  }
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <PortalSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <PortalTopbar session={session} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
