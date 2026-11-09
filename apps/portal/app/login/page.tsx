import { SignIn } from "@/components/arc/blocks/sign-in/sign-in";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#contenido">Ir al acceso</a>

      <div className={styles.hero}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">Y</span>
          <span>YZY Contracts</span>
        </div>

        <div className={styles.intro}>
          <p className={styles.slogan}>
            Del contrato al <em>documento</em>, sin fricción.
          </p>
          <p className={styles.description}>
            Diseñado para preparar tus contratos y convertirlos en documentos PDF, Word o correos.
          </p>
        </div>

        <svg className={styles.art} viewBox="0 0 450 300" aria-hidden="true">
          <rect className={styles.backSheet} x="8" y="44" width="260" height="190" rx="18" transform="rotate(-9 138 139)" />
          <g transform="rotate(4 236 135)">
            <rect className={styles.frontSheet} x="96" y="20" width="280" height="230" rx="18" />
            <rect className={styles.artAccent} x="116" y="40" width="22" height="22" rx="7" />
            <rect className={styles.artHeading} x="148" y="46" width="120" height="10" rx="5" />
            <g className={styles.artLines}>
              <rect x="116" y="72" width="240" height="8" rx="4" />
              <rect x="116" y="90" width="221" height="8" rx="4" />
              <rect x="116" y="108" width="240" height="8" rx="4" />
              <rect x="116" y="126" width="154" height="8" rx="4" />
            </g>
            <path className={styles.signature} transform="translate(116 186)" d="M4 30C14 6 22 6 20 24C18 40 30 36 38 20C44 8 50 30 60 28C70 26 76 14 84 22C92 30 100 26 116 12" />
          </g>
          <g className={styles.pdf} transform="rotate(6 368 16)">
            <rect x="340" y="0" width="56" height="32" rx="16" />
            <text x="368" y="16">PDF</text>
          </g>
          <g className={styles.word} transform="rotate(-4 406 144)">
            <rect x="372" y="128" width="68" height="32" rx="16" />
            <text x="406" y="144">Word</text>
          </g>
          <g className={styles.artMail} transform="rotate(-5 72 260)">
            <rect x="30" y="244" width="84" height="32" rx="16" />
            <text x="72" y="260">Correo</text>
          </g>
        </svg>

        <p className={styles.credit}>YZY Contracts powered by YZY Labs</p>
      </div>

      <section className={styles.access} id="contenido" tabIndex={-1} aria-label="Acceso a YZY Contracts">
        <SignIn />
      </section>
    </main>
  );
}
