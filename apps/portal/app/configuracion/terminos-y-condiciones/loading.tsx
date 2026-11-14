import { LoadingBlock, PortalLoading } from "@/components/loading/loading-ui";
import styles from "../legal-document.module.css";
import { SettingsBackLink } from "../settings";

const sections = [
  { headingWidth: 148, paragraphs: [["100%", "96%", "71%"]] },
  { headingWidth: 196, paragraphs: [["100%", "92%"], ["100%", "84%"]] },
  { headingWidth: 212, paragraphs: [["100%", "94%", "82%"]] },
  { headingWidth: 239, paragraphs: [["100%", "97%", "77%"]] },
  { headingWidth: 258, paragraphs: [["100%", "98%", "87%"]] },
  { headingWidth: 227, paragraphs: [["100%", "91%", "55%"]] },
  { headingWidth: 191, paragraphs: [["100%", "89%", "66%"]] },
];

export default function TermsLoading() {
  return (
    <PortalLoading
      currentPage="/configuracion"
      title="Términos y condiciones"
      description="Condiciones de uso del portal y de los documentos que generas."
      breadcrumb={<SettingsBackLink />}
      label="Cargando los términos y condiciones…"
    >
      <div className={styles.document}>
        {sections.map(({ headingWidth, paragraphs }) => (
          <div className={styles.section} key={headingWidth}>
            <div className={styles.placeholder}>
              <LoadingBlock width={headingWidth} />
            </div>
            {paragraphs.map(lines => (
              <div className={`${styles.copy} ${styles.placeholder}`} key={lines.join()}>
                {lines.map(width => <LoadingBlock key={width} width={width} />)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </PortalLoading>
  );
}
