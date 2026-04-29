import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MessageDetailClient } from "./MessageDetailClient";

export const metadata: Metadata = { title: "Chi tiết tin nhắn — VSO Gateway Portal" };

export default function MessageDetailPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/portal/messages" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Quay lại
        </Link>
      </div>
      <PageHeader title="Chi tiết tin nhắn" description={`ID: ${params.id}`} />
      <MessageDetailClient id={params.id} />
    </div>
  );
}
