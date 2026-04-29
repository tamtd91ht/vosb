import { Metadata } from "next";
import { ProvidersClient } from "./ProvidersClient";

export const metadata: Metadata = { title: "VOSB Gateway — Nhà cung cấp" };

export default function ProvidersPage() {
  return <ProvidersClient />;
}
