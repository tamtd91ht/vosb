import { Metadata } from "next";
import { PartnerDetailClient } from "./PartnerDetailClient";

export const metadata: Metadata = { title: "VOSB Gateway — Chi tiết đối tác" };

export default function PartnerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <PartnerDetailClient id={Number(params.id)} />;
}
