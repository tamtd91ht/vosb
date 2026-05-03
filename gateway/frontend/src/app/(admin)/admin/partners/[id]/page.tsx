import { Metadata } from "next";
import { PartnerDetailClient } from "./PartnerDetailClient";

export const metadata: Metadata = { title: "VOSB Gateway — Chi tiết đối tác" };

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PartnerDetailClient id={Number(id)} />;
}
