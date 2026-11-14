import { LoadingBlock } from "@/components/loading/loading-ui";
import editor from "./contract-editor.module.css";
import styles from "./contract-editor-skeleton.module.css";

export function ContractEditorSkeleton() {
  return (
    <>
      <div className={`${editor.panel} ${editor.details}`}>
        <div className={editor.fileDrop}>
          <div className={styles.dropzone}>
            <LoadingBlock width={206} height={15} />
            <LoadingBlock width={385} height={13} />
            <LoadingBlock width={328} height={11} />
          </div>
        </div>
        <div className={editor.fields}>
          <div className={styles.field}>
            <div className={styles.label}><LoadingBlock width={126} height={12} /></div>
            <LoadingBlock height={44} className={styles.control} />
          </div>
          <div className={styles.field}>
            <div className={styles.label}><LoadingBlock width={65} height={12} /></div>
            <LoadingBlock height={44} className={styles.control} />
          </div>
        </div>
      </div>

      <div className={editor.panel}>
        <div className={styles.heading}><LoadingBlock width={214} height={16} /></div>
        <div className={editor.editorFrame}>
          <div className={editor.editorHeader}>
            <div className={styles.editorHint}><LoadingBlock width={598} height={12} /></div>
            <div className={editor.history}>
              <LoadingBlock width={92} height="var(--control-height-md)" className={styles.control} />
              <LoadingBlock width={84} height="var(--control-height-md)" className={styles.control} />
            </div>
          </div>
          <div className={editor.editorArea}>
            <div className={styles.editorBody}>
              <LoadingBlock width={330} height={15} />
            </div>
          </div>
          <div className={`${editor.editorFooter} ${styles.editorFootnote}`}>
            <LoadingBlock width={348} height={12} />
          </div>
        </div>
        <div className={editor.actions}>
          <LoadingBlock width={109} height={44} className={styles.action} />
          <LoadingBlock width={158} height={44} className={styles.action} />
        </div>
      </div>
    </>
  );
}
