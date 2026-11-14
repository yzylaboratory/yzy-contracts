"""Builds small synthetic contracts in memory, with the standard library only.

Generated rather than committed: real contract formats are excluded from Git, and
this keeps the fixtures free of any real expediente.
"""

import io
import zipfile
from xml.sax.saxutils import escape

PDF_LINES = [
    "CONTRATO DE ARRENDAMIENTO DE EJEMPLO",
    "PRIMERA. OBJETO. El arrendador cede el uso del inmueble ficticio.",
    "SEGUNDA. PRECIO. La renta mensual de ejemplo es de 1,000 pesos.",
    "TERCERA. DURACION. El plazo de ejemplo es de doce meses.",
]

DOCX_PARAGRAPHS = [
    ("Title", "Contrato de servicios de ejemplo"),
    ("Heading1", "Primera. Objeto"),
    (None, "El prestador ficticio realizará los servicios descritos."),
    ("Heading1", "Segunda. Honorarios"),
    (None, "El cliente ficticio pagará la tarifa acordada."),
]

DOCX_TABLE = [["Concepto", "Importe"], ["Servicio de ejemplo", "1,000"]]


def build_pdf(lines: list[str] | None = None) -> bytes:
    """A one-page PDF with a real text layer."""
    content = ["BT", "/F1 12 Tf", "50 760 Td", "16 TL"]
    for line in lines or PDF_LINES:
        text = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content.append(f"({text}) Tj T*")
    content.append("ET")
    stream = "\n".join(content).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    output = io.BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(output.tell())
        output.write(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")
    xref_offset = output.tell()
    output.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        output.write(f"{offset:010d} 00000 n \n".encode())
    output.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode()
    )
    return output.getvalue()


def build_blank_pdf() -> bytes:
    """A valid PDF with no text at all, as a blank scan would be."""
    return build_pdf([""])


def _docx_paragraph(style: str | None, text: str) -> str:
    properties = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{properties}<w:r><w:t>{escape(text)}</w:t></w:r></w:p>"


def _docx_table(rows: list[list[str]]) -> str:
    cells = "".join(
        "<w:tr>"
        + "".join(f"<w:tc><w:p><w:r><w:t>{escape(cell)}</w:t></w:r></w:p></w:tc>" for cell in row)
        + "</w:tr>"
        for row in rows
    )
    return f"<w:tbl>{cells}</w:tbl>"


def build_docx(*, variables: bool = False) -> bytes:
    """A minimal DOCX with styled headings, paragraphs and a table."""
    body = "".join(_docx_paragraph(style, text) for style, text in DOCX_PARAGRAPHS)
    if variables:
        body += _docx_paragraph(None, "Cliente {{cliente_nombre}}. Firma {{cliente_nombre}}.")
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}{_docx_table(DOCX_TABLE)}</w:body></w:document>"
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + "".join(
            f'<w:style w:type="paragraph" w:styleId="{style_id}"><w:name w:val="{name}"/></w:style>'
            for style_id, name in [("Title", "Title"), ("Heading1", "heading 1")]
        )
        + "</w:styles>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        "</Types>"
    )
    package_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    document_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>"
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", package_rels)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/_rels/document.xml.rels", document_rels)
    return output.getvalue()
