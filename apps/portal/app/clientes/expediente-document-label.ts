export function expedienteDocumentLabel(value: string, filename = false) {
  const extension = filename ? value.match(/\.(?:docx|pdf|eml)$/i)?.[0] ?? "" : "";
  const name = extension ? value.slice(0, -extension.length) : value;
  if (name === "DECLARACION JURADA DE PERSONA FISICA") return `Declaración jurada de persona física${extension}`;
  if (name === "PODER ESPECIAL PARA LEVANTAMIENTO DE OPOSICION EN LA DGII") return `Poder especial para levantamiento de oposición en la DGII${extension}`;
  if (name === "ENTREGA DE VEHICULO") return `Entrega de vehículo${extension}`;
  if (name === "ENTREGA DE VEHICULO CON FINES DE SALDO") return `Entrega de vehículo con fines de saldo${extension}`;
  if (name !== name.toLocaleUpperCase("es")) return value;

  return name.toLocaleLowerCase("es").replace(/^\p{L}|\b(?:gps|dgii)\b|\(seguro\)/gui, word => word.toLocaleUpperCase("es")) + extension;
}

export function expedienteDownloadFilename(contractName: string, extension: "docx" | "pdf") {
  const label = expedienteDocumentLabel(contractName);
  const base = label.replace(/\.(?:docx|pdf|eml)$/i, "").trim() || "documento";
  return `${base}.${extension}`;
}
