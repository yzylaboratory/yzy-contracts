import type { ReactNode } from "react";
import { Stepper } from "@/components/arc/stepper/stepper";
import styles from "./clients.module.css";

const steps = [
  { id: "client", label: "Cliente" },
  { id: "application", label: "Solicitud de préstamo" },
  { id: "review", label: "Revisión y confirmación" },
];

export function CaseIntakeSteps({ current, onStepSelect, children }: {
  current: 0 | 1 | 2;
  onStepSelect?: (index: number) => void;
  children: ReactNode;
}) {
  return <div className={styles.intakeLayout}>
    <Stepper steps={steps} current={current} onStepSelect={onStepSelect} orientation="horizontal"
      label="Etapas del expediente" className={styles.intakeSteps} locale="es" />
    <div className={styles.stack}>{children}</div>
  </div>;
}
