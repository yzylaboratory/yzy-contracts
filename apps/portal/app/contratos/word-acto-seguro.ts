import { CONDITIONAL_SALE_TITLE } from "./document-catalog";

export const actoSeguroBoldFields = ["fecha_firma", "cuotas_seguro_fechas"] as const;

function paragraphText(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagNameNS(paragraph.namespaceURI, "t"), node => node.textContent ?? "").join("");
}

export function formatActoSeguro(doc: Document): void {
  const ns = doc.documentElement.namespaceURI;
  const body = doc.getElementsByTagNameNS(ns, "body")[0];
  if (!body) return;

  const paragraphs = Array.from(body.children).filter(element => element.namespaceURI === ns && element.localName === "p");
  const heading = paragraphs.find(paragraph => paragraphText(paragraph).trim() === CONDITIONAL_SALE_TITLE);
  if (heading) {
    const lastText = Array.from(heading.getElementsByTagNameNS(ns, "t")).findLast(node => node.textContent?.trim());
    if (lastText) lastText.textContent = `${lastText.textContent?.trimEnd()} (SEGURO)`;
  }
  const opening = paragraphs.find(paragraph => /^INVERSIONES MARTÍNEZ ROSARIO, S\.R\.L\./iu.test(paragraphText(paragraph).trimStart()));
  if (opening) {
    const indentation = opening.getElementsByTagNameNS(ns, "ind")[0];
    indentation?.removeAttributeNS(ns, "hanging");
    for (const run of Array.from(opening.getElementsByTagNameNS(ns, "r"))) {
      const contents = Array.from(run.children).filter(node => node.namespaceURI === ns && node.localName !== "rPr");
      if (contents.some(node => node.localName !== "tab" && (node.localName !== "t" || node.textContent?.trim()))) {
        const firstText = contents.find(node => node.localName === "t");
        if (firstText) firstText.textContent = firstText.textContent?.trimStart() ?? "";
        break;
      }
      contents.forEach(node => node.remove());
    }
  }

  const buyerSignature = paragraphs.find(paragraph => paragraphText(paragraph).trim() === "FIRMA DEL COMPRADOR");
  const buyerDetails = buyerSignature?.nextElementSibling;
  if (buyerDetails?.namespaceURI !== ns || buyerDetails?.localName !== "tbl") return;
  for (const paragraph of Array.from(buyerDetails.getElementsByTagNameNS(ns, "p"))) {
    const label = /^(Nombre|Cédula|Dirección):/u.exec(paragraphText(paragraph).trimStart());
    if (!label) continue;
    const [first, ...rest] = Array.from(paragraph.getElementsByTagNameNS(ns, "t"));
    first.textContent = label[0];
    rest.forEach(node => { node.textContent = ""; });
  }
}
