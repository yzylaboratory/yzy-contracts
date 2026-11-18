import { LegalDocumentScreen } from '../src/features/settings/ui/LegalDocumentScreen';
import { TermsContent } from '../src/features/settings/ui/TermsContent';

export default function TerminosRoute() {
  return (
    <LegalDocumentScreen
      title="Términos y condiciones"
      description="Condiciones de uso del portal y de los documentos que generas."
    >
      <TermsContent />
    </LegalDocumentScreen>
  );
}