import { LegalDocumentScreen } from '../src/features/settings/ui/LegalDocumentScreen';
import { PrivacyContent } from '../src/features/settings/ui/PrivacyContent';

export default function PrivacidadRoute() {
  return (
    <LegalDocumentScreen
      title="Políticas de privacidad"
      description="Cómo YZY Contracts utiliza los datos y qué puedes hacer para gestionarlos."
    >
      <PrivacyContent />
    </LegalDocumentScreen>
  );
}