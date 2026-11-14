import type { Metadata } from "next";
import { CompanyPicker } from "./company-picker";

export const metadata: Metadata = {
  title: "Mis empresas | YZY Contracts",
};

export default function CompaniesPage() {
  return <CompanyPicker />;
}
