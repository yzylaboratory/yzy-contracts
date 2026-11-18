export function expedienteDocumentLabel(value: string, filename = false) {
  const extension = filename ? value.match(/\.(?:docx|pdf|eml)$/i)?.[0] ?? "" : "";
  const name = extension ? value.slice(0, -extension.length) : value;
  if (name !== name.toLocaleUpperCase("es")) return value;

  return name.toLocaleLowerCase("es").replace(/^\p{L}|\b(?:gps|dgii)\b/gu, word => word.toLocaleUpperCase("es")) + extension;
}
