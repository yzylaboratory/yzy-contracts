from __future__ import annotations

import io
from pathlib import Path

from docx import Document
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def build_digital_contract_pdf() -> bytes:
    """Create a synthetic Spanish digital contract PDF with headings, numbered items, and a table."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter)
    styles = getSampleStyleSheet()
    story = [
        Paragraph("CONTRATO DE SERVICIOS PROFESIONALES", styles["Title"]),
        Spacer(1, 12),
        Paragraph("PRIMERA: OBJETO DEL CONTRATO", styles["Heading2"]),
        Paragraph(
            "El contratista se compromete a prestar los servicios de consultoría tecnológica "
            "en Santo Domingo, República Dominicana, con ética y diligencia.",
            styles["BodyText"],
        ),
        Spacer(1, 10),
        Paragraph("SEGUNDA: OBLIGACIONES Y LISTADO", styles["Heading2"]),
        Paragraph("1. Entregar informes técnicos mensuales.", styles["BodyText"]),
        Paragraph("2. Garantizar confidencialidad sobre la información.", styles["BodyText"]),
        Paragraph("3. Cumplir los niveles de servicio acordados.", styles["BodyText"]),
        Spacer(1, 10),
        Paragraph("TERCERA: MONTO Y FORMA DE PAGO", styles["Heading2"]),
        Paragraph(
            "El monto total acordado es RD$50,000.00 pagaderos según el siguiente desglose:",
            styles["BodyText"],
        ),
        Spacer(1, 8),
    ]

    table_data = [
        ["Hito", "Descripción", "Monto"],
        ["Fase 1", "Diagnóstico inicial", "RD$20,000.00"],
        ["Fase 2", "Implementación final", "RD$30,000.00"],
    ]
    table = Table(table_data, colWidths=[100, 220, 120])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("GRID", (0, 0), (-1, -1), 1, colors.black),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(table)
    doc.build(story)
    return buf.getvalue()


def build_scanned_contract_pdf() -> bytes:
    """Create a synthetic image-only (scanned) PDF containing Spanish contract text."""
    img = Image.new("RGB", (1400, 900), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((80, 100), "CONTRATO DE ARRENDAMIENTO", fill="black", font_size=36)
    draw.text((80, 200), "PRIMERA: OBJETO DEL CONTRATO", fill="black", font_size=28)
    draw.text(
        (80, 290),
        "El arrendador entrega en alquiler el local comercial por RD 45000.",
        fill="black",
        font_size=28,
    )
    draw.text((80, 390), "SEGUNDA: PLAZO DE VIGENCIA", fill="black", font_size=28)
    draw.text(
        (80, 480),
        "La duracion del presente acuerdo es de doce (12) meses.",
        fill="black",
        font_size=28,
    )

    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=150.0)
    return buf.getvalue()


def build_encrypted_pdf(password: str = "secret123") -> bytes:
    """Create a password-protected PDF from a synthetic PDF."""
    raw = build_digital_contract_pdf()
    reader = PdfReader(io.BytesIO(raw))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(password)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def build_contract_docx() -> bytes:
    """Create a synthetic DOCX contract with Spanish accents, numbered lists, and a table."""
    doc = Document()
    doc.add_heading("CONTRATO DE SERVICIOS", level=1)
    doc.add_heading("PRIMERA: OBJETO DEL CONTRATO", level=2)
    doc.add_paragraph(
        "El contratista se compromete a prestar los servicios descritos con carácter "
        "técnico en la ciudad de Santo Domingo, República Dominicana."
    )
    doc.add_heading("SEGUNDA: ENTREGABLES NUMERADOS", level=2)
    doc.add_paragraph("1. Diseño de arquitectura del sistema.", style="List Number")
    doc.add_paragraph("2. Pruebas de integración y seguridad.", style="List Number")
    doc.add_paragraph("3. Documentación operativa en español.", style="List Number")

    doc.add_heading("TERCERA: MONTO Y TABLA DE PAGOS", level=2)
    doc.add_paragraph("El monto acordado es RD$50,000 distribuido así:")

    table = doc.add_table(rows=3, cols=2)
    table.cell(0, 0).text = "Concepto"
    table.cell(0, 1).text = "Monto"
    table.cell(1, 0).text = "Anticipo inicial"
    table.cell(1, 1).text = "RD$25,000"
    table.cell(2, 0).text = "Entrega final"
    table.cell(2, 1).text = "RD$25,000"

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def ensure_fixture_files(directory: Path) -> dict[str, Path]:
    """Write synthetic fixture files to `tests/fixtures/files/` for inspection and reuse."""
    directory.mkdir(parents=True, exist_ok=True)
    digital_pdf = directory / "contrato_digital.pdf"
    scanned_pdf = directory / "contrato_escaneado.pdf"
    contract_docx = directory / "contrato_servicios.docx"

    if not digital_pdf.exists():
        digital_pdf.write_bytes(build_digital_contract_pdf())
    if not scanned_pdf.exists():
        scanned_pdf.write_bytes(build_scanned_contract_pdf())
    if not contract_docx.exists():
        contract_docx.write_bytes(build_contract_docx())

    return {
        "digital_pdf": digital_pdf,
        "scanned_pdf": scanned_pdf,
        "contract_docx": contract_docx,
    }
