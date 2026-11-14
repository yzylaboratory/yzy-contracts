import type { Metadata } from "next";
import { Administration } from "../administration";

export const metadata: Metadata = { title: "Usuarios | YZY Contracts", robots: { index: false } };

export default function AdminUsersPage() {
  return <Administration section="users" />;
}
