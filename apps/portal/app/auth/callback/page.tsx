import type { Metadata } from "next";
import { AuthCallback } from "./auth-callback";

export const metadata: Metadata = {
  title: "Confirmación de acceso | YZY Contracts",
};

export default function AuthCallbackPage() {
  return <AuthCallback />;
}
