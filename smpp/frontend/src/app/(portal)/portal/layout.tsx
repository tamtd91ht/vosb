// AUTH BYPASS — restore when BE is ready: check role === "PARTNER"
import { PortalSidebar } from "@/components/layout/PortalSidebar";
import { PortalTopbar } from "@/components/layout/PortalTopbar";

const MOCK_SESSION = {
  user: { id: "2", name: "partner1", role: "PARTNER", partnerId: 1 },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <PortalSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <PortalTopbar session={MOCK_SESSION as never} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
