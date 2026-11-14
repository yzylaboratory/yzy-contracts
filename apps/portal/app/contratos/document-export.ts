type DocumentFormat = "pdf" | "docx";

type DocumentLine = {
  heading: number;
  text: string;
};

function plainInlineText(markdown: string) {
  const escaped: string[] = [];
  // Protect escaped characters until the Markdown formatting has been removed.
  return markdown
    .replace(/\\([\\`*_~\[\]<>!#()+.:|-])/g, (_, character: string) => `\0${escaped.push(character) - 1}\0`)
    .replace(/^>\s?/, "")
    .replace(/^[-+*]\s+/, "• ")
    .replace(/!?\[([^\]\n]+)\]\([^)\n]+\)/g, "$1")
    .replace(/(\*\*|__|~~|`|\*|_)(.+?)\1/g, "$2")
    .replace(/\0(\d+)\0/g, (marker, index: string) => escaped[Number(index)] ?? marker);
}

export function getDocumentLines(markdown: string): DocumentLine[] {
  let fence = "";

  return markdown.trim().split(/\r?\n/).flatMap(line => {
    const fenceMarker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMarker && (!fence || fenceMarker[1].startsWith(fence))) {
      fence = fence ? "" : fenceMarker[1];
      return [];
    }
    if (fence) return [{ heading: 0, text: line }];

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    return [{ heading: heading?.[1].length ?? 0, text: plainInlineText(heading?.[2] ?? line.trim()) }];
  });
}

export async function createDocumentBlob(
  format: DocumentFormat,
  title: string,
  markdown: string,
): Promise<Blob> {
  const lines = getDocumentLines(markdown);

  if (format === "docx") {
    const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
    const document = new Document({
      title,
      sections: [{
        children: lines.map(({ heading, text }) => new Paragraph({
          text,
          heading: heading === 1 ? HeadingLevel.HEADING_1 : heading > 1 ? HeadingLevel.HEADING_2 : undefined,
        })),
      }],
    });

    return Packer.toBlob(document);
  }

  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ format: "a4", unit: "mm" });
  document.setProperties({ title });
  const margin = 20;
  const maxWidth = document.internal.pageSize.getWidth() - margin * 2;
  const maxY = document.internal.pageSize.getHeight() - margin;
  let y = margin;

  for (const { heading, text } of lines) {
    if (!text) {
      y += 4;
      continue;
    }

    document.setFont("helvetica", heading ? "bold" : "normal");
    document.setFontSize(heading === 1 ? 17 : heading > 1 ? 13 : 11);
    const lineHeight = heading ? 7 : 5.5;
    const wrapped: string[] = document.splitTextToSize(text, maxWidth);

    for (const line of wrapped) {
      if (y > maxY) {
        document.addPage();
        y = margin;
      }
      document.text(line, margin, y);
      y += lineHeight;
    }
  }

  return document.output("blob");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function encodeSubject(subject: string): string {
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = "";

  for (const character of subject.replace(/\r\n|\r|\n/g, " ")) {
    if (encoder.encode(chunk + character).length > 39) {
      words.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) words.push(chunk);

  return words.map(word => `=?UTF-8?B?${encodeBase64(encoder.encode(word))}?=`).join("\r\n ");
}

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 &&
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value);
}

export async function createEmailDraftBlob(input: {
  to: string;
  cc?: string;
  subject: string;
  message: string;
  attachment: Blob;
  attachmentName: string;
}): Promise<Blob> {
  const to = input.to.trim();
  const cc = input.cc?.trim();
  if (!isEmailAddress(to) || (cc && !isEmailAddress(cc))) {
    throw new Error("Escribe una dirección de correo válida.");
  }

  const boundary = `yzy-${crypto.randomUUID()}`;
  const attachmentName = input.attachmentName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const attachmentType = attachmentName.toLowerCase().endsWith(".docx")
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
  const message = new TextEncoder().encode(input.message.replace(/\r\n|\r|\n/g, "\r\n"));
  const attachment = new Uint8Array(await input.attachment.arrayBuffer());

  return new Blob([[
    "X-Unsent: 1",
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodeSubject(input.subject.trim())}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(encodeBase64(message)),
    `--${boundary}`,
    `Content-Type: ${attachmentType}`,
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(encodeBase64(attachment)),
    `--${boundary}--`,
    "",
  ].join("\r\n")], { type: "message/rfc822" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Keep the URL alive long enough for the browser to start the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
