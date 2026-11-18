import type { Metadata } from "next";
import { ProspectWelcome } from "./prospect-welcome";
import styles from "./prospect-form.module.css";

export const metadata: Metadata = {
  title: "Completar datos de prospecto | YZY Contracts",
  description: "Completa tus datos para que el equipo pueda revisarlos.",
  robots: {
    index: false,
    follow: false,
  },
  referrer: "no-referrer",
};

export default function ProspectoLayout({ children }: LayoutProps<"/prospecto">) {
  return (
    <main className={styles.page}>
      <h1 className={styles.srOnly}>Completa tus datos</h1>
      <ProspectWelcome>{children}</ProspectWelcome>
    </main>
  );
}
