import { Metadata } from "next";
import { ProvidersClient } from "./ProvidersClient";

export const metadata: Metadata = { title: "VSO Gateway — Nhà cung cấp" };

export default function ProvidersPage() {
  return <ProvidersClient />;
}
