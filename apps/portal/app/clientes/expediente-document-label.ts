export function expedienteDocumentLabel(value: string, filename = false) {
  const extension = filename ? value.match(/\.(?:docx|pdf|eml)$/i)?.[0] ?? "" : "";
  const name = extension ? value.slice(0, -extension.length) : value;
  if (!filename) {
    if (name === "DECLARACION JURADA DE PERSONA FISICA") return "Declaración jurada de persona física";
    if (name === "PODER ESPECIAL PARA LEVANTAMIENTO DE OPOSICION EN LA DGII") return "Poder especial para levantamiento de oposición en la DGII";
  }
  if (name !== name.toLocaleUpperCase("es")) return value;

  return name.toLocaleLowerCase("es").replace(/^\p{L}|\b(?:gps|dgii)\b/gu, word => word.toLocaleUpperCase("es")) + extension;
}
