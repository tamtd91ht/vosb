import { Metadata } from "next";
import { ProviderDetailClient } from "./ProviderDetailClient";

export const metadata: Metadata = { title: "VSO Gateway — Chi tiết nhà cung cấp" };

export default function ProviderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <ProviderDetailClient id={Number(params.id)} />;
}
