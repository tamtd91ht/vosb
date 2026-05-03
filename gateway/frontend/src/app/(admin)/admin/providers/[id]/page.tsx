import { Metadata } from "next";
import { ProviderDetailClient } from "./ProviderDetailClient";

export const metadata: Metadata = { title: "VOSB Gateway — Chi tiết nhà cung cấp" };

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProviderDetailClient id={Number(id)} />;
}
