import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { SessionsClient } from "./SessionsClient";

export const metadata: Metadata = { title: "Sessions — VOSB Gateway" };

export default function SessionsPage() {
  return (
    <div>
      <PageHeader
        title="SMPP Sessions"
        description="Phiên SMPP đang bind từ partner đến gateway"
      />
      <SessionsClient />
    </div>
  );
}
