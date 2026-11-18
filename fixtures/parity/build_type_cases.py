"""Synthetic Word bodies for the 18 document types of the catalog (`document-catalog.ts`).

Each reviewed type gets a body shaped for its portal layout: company paragraph ranges from
`company-reference-ranges.ts` (read by `build_tables.py`), the layout triggers of
`word-*.ts`, and the native markers. Non-reviewed types get plain marker bodies.
Every value is synthetic: names, cédulas, plates and bank data are invented here.

Reviewed bodies are fingerprinted into `reviewed_bodies.json`; the oracle's shim
(`oracle/reference-word-shim.mjs`) and the Rust parity test read that file.
"""
import hashlib
import re
from xml.sax.saxutils import escape

import build_cases as base
import build_tables

CONDITIONAL_SALE_TITLE = "CONTRATO DE VENTA CONDICIONAL DE MUEBLES"
SIGNATURE_LINE = "_" * 25
LOWER_COMPANY_KEYS = {
    "empresa_representante_cargo",
    "empresa_representante_nacionalidad",
    "empresa_representante_estado_civil",
    "empresa_representante_ocupacion",
    "empresa_tipo_cuenta",
}

VEHICLE = {
    "vehicle_type": "Camioneta",
    "make": "MARCA-SINTETICA",
    "model": "MODELO-X",
    "year": "2020",
    "color": "GRIS",
    "registration_number": "REG-000123",
    "chassis_number": "CHS-000999",
    "plate": "A000001",
    "engine_number": "MOT-42",
}
VEHICLE_FIELDS = [
    ("Tipo", "vehicle_type"),
    ("Marca", "make"),
    ("Modelo", "model"),
    ("Año", "year"),
    ("Color", "color"),
    ("Matrícula", "registration_number"),
    ("Chasis", "chassis_number"),
    ("Placa", "plate"),
    ("Motor", "engine_number"),
]

SYNTHETIC_COMPANY = {
    "empresa_razon_social": "EMPRESA SINTETICA DE PRUEBA SRL",
    "empresa_rnc": "101000001",
    "empresa_direccion": "CALLE SINTETICA UNO, SANTO DOMINGO, PRUEBA",
    "empresa_representante_nombre": "Representante Sintetico Uno Dos",
    "empresa_representante_nombre_firma": "Representante S. Uno Dos",
    "empresa_representante_cargo": "GERENTE",
    "empresa_representante_nacionalidad": "DOMINICANO",
    "empresa_representante_estado_civil": "SOLTERO",
    "empresa_representante_ocupacion": "COMERCIANTE",
    "empresa_representante_cedula": "402-1234567-8",
    "empresa_representante_cedula_letras": "",
    "empresa_representante_direccion": "calle sintetica dos, santo domingo",
    "empresa_testigo_richard": "Testigo Sintetico Richard Uno",
    "empresa_testigo_usuario": "Testigo Sintetico Usuario Dos",
    "empresa_testigo_usuario_nombre_declaracion": "Testigo Usuario Sintetico Cuatro",
    "empresa_banco": "BANCO SINTETICO",
    "empresa_cuenta": "000-000001",
    "empresa_tipo_cuenta": "corriente",
    "empresa_titular_cuenta": "EMPRESA SINTETICA DE PRUEBA SRL",
    "empresa_horario_pagos": "lunes a viernes, de 8:00 a. m. a 5:00 p. m.",
}
COMPANY_NAME = "Empresa Sintetica de Prueba"

VALUES = {
    "cliente_nombre": "Cliente Sintetico Uno",
    "cliente_nombre_firma": "Cliente Sintetico Uno",
    "cliente_cedula": "40212345678",
    "cliente_cedula_letras": "cuatro cero dos guion uno dos tres cuatro cinco seis siete guion ocho",
    "cliente_direccion": "calle sintetica 1, santo domingo",
    "cliente_direccion_transito": "calle sintetica 1, santo domingo y de tránsito por la capital de la República Dominicana",
    "cliente_tratamiento": "Sr.",
    "cliente_nacionalidad": "DOMINICANO",
    "cliente_estado_civil": "SOLTERO",
    "cliente_ocupacion": "COMERCIANTE",
    "cliente_telefono": "809-000-0000",
    "cliente_correo": "sintetico@example.com",
    "cliente_origen_ingresos": "SALARIO",
    "operacion_referencia": "REF-000001",
    "fecha_contrato": "2026-11-16",
    "fecha_firma": "2026-11-16",
    "fecha_de_firma": "2026-11-16",
    "fecha_cuota_final_capital": "2027-01-05",
    "fecha_saldo": "2026-11-16",
    "fecha_ancla_cuota_extraordinaria": "2026-12-16",
    "saldo_confirmado": "RD$ 1,000.00",
    "saldo_confirmado_letras": "MIL PESOS CON 00/100 CENTAVOS DOMINICANOS",
    "parrafo_compromiso_pago": "se compromete a pagar la suma sintetica de prueba",
    "cuotas_intereses": "tres (3) cuotas de RD$ 100.00 cada una",
    "cuotas_intereses_numeros": "1\n2\n3",
    "cuotas_intereses_fechas": "16/12/2026\n16/01/2027\n16/02/2027",
    "cuotas_intereses_montos": "RD$ 100.00\nRD$ 100.00\nRD$ 100.00",
    "cuota_final_capital": "2027-01-05, RD$ 1,000.00",
    "cuota_final_capital_monto": "RD$ 1,000.00",
    "cuota_final_capital_letras": "MIL PESOS CON 00/100 CENTAVOS DOMINICANOS",
    "fecha_cuota_final_capital_letras": "CINCO (05) DE ENERO DEL AÑO DOS MIL VEINTISIETE (2027)",
    "numero_cuota_final_capital": "4",
    "cuota_intereses_monto": "RD$ 100.00",
    "cuota_intereses_monto_letras": "CIEN PESOS CON 00/100 CENTAVOS DOMINICANOS",
    "fecha_primera_cuota_intereses_letras": "DIECISÉIS (16) DE DICIEMBRE DEL AÑO DOS MIL VEINTISÉIS (2026)",
    "total_financiamiento": "RD$ 1,300.00",
    "total_financiamiento_letras": "MIL TRESCIENTOS PESOS CON 00/100 CENTAVOS DOMINICANOS",
    "monto_desembolso": "RD$ 1,000.00",
    "distribucion_desembolso": "distribucion sintetica de prueba",
    "cantidad_cuotas": "4",
    "cantidad_cuotas_letras": "CUATRO",
    "cantidad_cuotas_intereses": "3",
    "cantidad_cuotas_intereses_letras": "TRES",
    "cantidad_cuotas_seguro": "3",
    "cantidad_cuotas_seguro_letras": "TRES",
    "cuotas_seguro_numeros": "1\n2\n3",
    "cuotas_seguro_fechas": "16/12/2026\n16/01/2027\n16/02/2027",
    "cuotas_seguro_montos": "RD$ 50.00\nRD$ 50.00\nRD$ 50.00",
    "monto_total_seguro": "RD$ 150.00",
    "monto_total_seguro_letras": "CIENTO CINCUENTA PESOS CON 00/100 CENTAVOS DOMINICANOS",
    "monto_cuota_seguro": "RD$ 50.00",
    "monto_cuota_seguro_letras": "CINCUENTA PESOS CON 00/100 CENTAVOS DOMINICANOS",
    "monto_de_cada_cuota": "RD$ 100.00",
    "monto_total_financiado": "RD$ 1,000.00",
    "monto_total_financiado_en_letras": "MIL PESOS CON 00/100 CENTAVOS DOMINICANOS",
    "fecha_primera_cuota_seguro": "2026-12-16",
    "fecha_ultima_cuota_seguro": "2027-03-16",
    "testigo_richard": "Testigo Sintetico Richard Uno",
    "testigo_usuario": "Testigo Sintetico Usuario Dos",
    "nombre_del_notario": "Notario Sintetico Uno",
    "representante_seguro_nombre": "Representante Sintetico Seguro",
    "saldo_confirmado_letras_upper": "MIL PESOS",
    "monto_total_financiado_letras": "MIL PESOS",
    "vehiculo_garantia": "",
    "vehiculo_descripcion": "",
    "vehiculo_ano": VEHICLE["year"],
    "placa_del_vehiculo": VEHICLE["plate"],
}
for number in range(1, 11):
    VALUES[f"fecha_de_vencimiento_de_la_cuota_{number}"] = f"2026-{12 if number == 1 else 1:02d}-16"
for index, field in enumerate(["vehicle_type", "make", "model", "year", "color", "registration_number",
                               "chassis_number", "plate", "engine_number"]):
    VALUES[f"vehiculo_{['tipo','marca','modelo','anio','color','matricula','chasis','placa','motor'][index]}"] = VEHICLE[field]
VALUES["vehiculo_tipo"] = VEHICLE["vehicle_type"]

def expediente_vehicle_description():
    parts = []
    for label, field in VEHICLE_FIELDS:
        value = VEHICLE.get(field, "").strip()
        if value:
            parts.append(f"{label} {value}")
    return ", ".join(parts)


VALUES["vehiculo_garantia"] = expediente_vehicle_description()
VALUES["vehiculo_descripcion"] = VALUES["vehiculo_garantia"]

NAME_KEYS = {"cliente_nombre", "cliente_nombre_firma", "testigo_richard", "testigo_usuario", "nombre_del_notario",
             "representante_seguro_nombre"}


def field_spec(key):
    if key.startswith("fecha_"):
        style = "long" if key in ("fecha_firma", "fecha_de_firma", "fecha_saldo") else "numeric"
        return {"key": key, "label": key, "kind": "date", "required": False, "dateStyle": style}
    if key == "cliente_cedula":
        return {"key": key, "label": key, "kind": "identity", "required": False}
    if key.startswith(("cuotas_", "cantidad_", "monto_", "saldo_")) or key in {"cuota_final_capital", "total_financiamiento"}:
        return {"key": key, "label": key, "kind": "money" if key.startswith("monto") else "text", "required": False}
    return {"key": key, "label": key, "kind": "text", "required": False}


def value_for(key):
    if key in VALUES:
        return VALUES[key]
    return f"Valor sintetico de {key}"


# --- body builders -------------------------------------------------------------------------

def run(text, bold=False):
    props = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:r>{props}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def para(*runs, ppr=""):
    return f"<w:p>{ppr}{''.join(runs)}</w:p>"


def text_para(text, bold=False, ppr=""):
    return para(run(text, bold), ppr=ppr)


def table(rows):
    body = "".join(
        "<w:tr>" + "".join(f"<w:tc><w:tcPr><w:tcW w:w=\"2000\" w:type=\"dxa\"/></w:tcPr>{cell}</w:tc>" for cell in row) + "</w:tr>"
        for row in rows
    )
    return f'<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid>{"<w:gridCol w:w=\"2000\"/>" * len(rows[0])}</w:tblGrid>{body}</w:tbl>'


def company_filler(model):
    """Paragraphs 0..N-1 of the body, carrying the company spans of the reviewed model."""
    ranges = build_tables.company_ranges().get(model, [])
    if not ranges:
        return []
    count = max(paragraph for paragraph, _, _, _ in ranges) + 1
    paragraphs = []
    for index in range(count):
        spans = sorted((start, end, key) for paragraph, start, end, key in ranges if paragraph == index)
        length = max([end for _, end, _ in spans] + [0]) + 12
        chars = list("áéíóú lorem ipsum ñandú dolor sit amet " * (length // 40 + 2))[:length]
        for start, end, key in spans:
            width = end - start
            if key in LOWER_COMPANY_KEYS:
                literal = ("ñandú" * width)[:width]
            else:
                literal = ("ÁBCÑÉ" * width)[:width]
            chars[start:end] = list(literal)
        paragraphs.append(text_para("".join(chars)))
    return paragraphs


def markers(keys):
    return [text_para("Campo {{" + key + "}} fin.") for key in keys]


def document_xml(blocks):
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{base.W}" xmlns:r="{base.R}"><w:body>{"".join(blocks)}'
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
        "</w:sectPr></w:body></w:document>"
    )


def fingerprint(xml):
    return hashlib.sha256(xml.encode("utf-8")).hexdigest()


# --- per-type bodies -----------------------------------------------------------------------

def pagare_autentico_blocks():
    opening = para(
        run("ACTO"), run(" "), run("Número"), run(","), run(" "),
        run("En la Ciudad de Santo Domingo, Distrito Nacional, a los {{fecha_firma}} "),
    )
    witness = para(
        run(SIGNATURE_LINE + " " + SIGNATURE_LINE),
        run("{{cliente_nombre}} "),
        run("{{testigo_richard}} TESTIGO TESTIGO "),
        run("_"),
    )
    return [opening, witness]


def entrega_voluntaria_blocks():
    opening = para(
        run("En la  Ciudad de Santo Domingo, Distrito Nacional, Capital de la República "),
        run("Dominicana, a {{fecha_firma}}"),
        run("; por ante mí Notario "),
    )
    cell = lambda text: text_para(text)
    witnesses = table([
        [cell(SIGNATURE_LINE), cell(SIGNATURE_LINE)],
        [cell("{{testigo_richard}}"), cell("{{testigo_usuario}}")],
        [cell("TESTIGO"), cell("TESTIGO")],
    ])
    return [opening, witnesses]


def entrega_vehiculo_blocks():
    return [
        text_para("{{cliente_nombre}}"),
        text_para("RECIBIDO POR:"),
        text_para(""),
        text_para("{{cliente_nombre_firma}}"),
        text_para("ENTREGADO POR:"),
    ]


def acto_seguro_blocks():
    heading = text_para(CONDITIONAL_SALE_TITLE)
    opening = para(
        '<w:r><w:tab/></w:r>',
        run("  INVERSIONES MARTÍNEZ ROSARIO, S.R.L., representada por su representante legal."),
        ppr='<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>',
    )
    payments = table([[
        text_para("{{cuotas_seguro_numeros}}"),
        text_para("{{cuotas_seguro_fechas}}"),
        text_para("{{cuotas_seguro_montos}}"),
    ]])
    signature = text_para("FIRMA DEL COMPRADOR")
    buyer = table([
        [text_para("Nombre: {{cliente_nombre}}")],
        [text_para("Cédula: {{cliente_cedula}}")],
        [text_para("Dirección: {{cliente_direccion}}")],
    ])
    return [heading, opening, payments, signature, buyer]


def gps_blocks():
    signature = text_para("", ppr='<w:pPr><w:spacing w:before="0" w:after="0"/><w:contextualSpacing/></w:pPr>')
    notary = text_para("ABOGADO NOTARIO")
    debtor = para(run("   SEGUNDA PARTE O DEUDOR"))
    return [signature, notary, debtor]


def declaracion_jurada_blocks():
    signatures = para(
        run(SIGNATURE_LINE), run(" "), run("{{testigo_richard}}"), run("  "), run("{{testigo_usuario}}"),
    )
    labels = para(run("TESTIGO"), run("   "), run("TESTIGO"))
    return [signatures, labels]


def venta_condicional_blocks(pdf=False):
    title = text_para(CONDITIONAL_SALE_TITLE)
    subtitle = text_para("Fecha del contrato: {{fecha_contrato}}")
    parties = para(
        run("   Comparecen {{cliente_nombre}}, de nacionalidad {{cliente_nacionalidad}}."),
        ppr='<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:ind w:left="720"/></w:pPr>',
    )
    clause = text_para("CLÁUSULA PRIMERA: objeto de la venta sintetica.",
                       ppr='<w:pPr><w:ind w:left="0"/></w:pPr>')
    payments = table([[
        text_para("{{cuotas_intereses_numeros}}"),
        text_para("{{cuotas_intereses_fechas}}"),
        text_para("{{cuotas_intereses_montos}}"),
    ]])
    blocks = [title, subtitle, parties, clause, payments]
    if pdf:
        # The PDF writer needs the floating payment table and the furniture description table.
        payments = payments.replace(
            "<w:tblPr><w:tblW",
            '<w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" '
            'w:horzAnchor="margin" w:tblpY="0"/><w:tblW',
            1,
        )
        blocks = [title, subtitle, parties, clause, payments]
        description = (
            '<w:tbl><w:tblPr><w:tblW w:w="5954" w:type="dxa"/><w:jc w:val="left"/></w:tblPr>'
            '<w:tblGrid><w:gridCol w:w="5954"/></w:tblGrid><w:tr><w:tc><w:tcPr>'
            '<w:tcW w:w="5954" w:type="dxa"/></w:tcPr>'
            + text_para("DESCRIPCIÓN DEL MUEBLE")
            + "</w:tc></w:tr></w:tbl>"
        )
        blocks = [title, subtitle, parties, clause, payments, description]
    signature = text_para("FIRMA DEL COMPRADOR")
    buyer = table([
        [para(run("Nombre"), run(": {{cliente_nombre}}"))],
        [para(run("Cédula"), run(": {{cliente_cedula}}"))],
        [para(run("Dirección"), run(": {{cliente_direccion}}"))],
    ])
    return blocks + [signature, buyer]


# Keys written as plain markers after the layout blocks, per type.
TYPE_MARKERS = {
    "venta_condicional": ["fecha_firma", "vehiculo_tipo", "vehiculo_garantia", "vehiculo_matricula",
                          "parrafo_compromiso_pago", "cuota_final_capital", "total_financiamiento",
                          "fecha_cuota_final_capital", "cuota_final_capital_monto", "cliente_direccion_transito",
                          "monto_desembolso", "cantidad_cuotas", "cantidad_cuotas_letras", "cliente_cedula_letras",
                          "fecha_cuota_final_capital_letras", "fecha_primera_cuota_intereses_letras",
                          "cuota_intereses_monto", "total_financiamiento_letras", "cliente_tratamiento",
                          "vehiculo_ano", "operacion_referencia", "cliente_telefono", "cliente_correo",
                          "cliente_origen_ingresos", "cantidad_cuotas_intereses"],
    "venta_condicional_seguro": ["fecha_de_firma", "placa_del_vehiculo", "monto_de_cada_cuota",
                                 "monto_total_financiado", "monto_total_financiado_en_letras",
                                 "fecha_de_vencimiento_de_la_cuota_1", "fecha_de_vencimiento_de_la_cuota_2",
                                 "fecha_de_vencimiento_de_la_cuota_3", "fecha_de_vencimiento_de_la_cuota_10",
                                 "cliente_nombre", "cliente_direccion"],
    "pagare_autentico": ["cliente_cedula_letras", "cliente_direccion", "vehiculo_garantia", "fecha_firma",
                         "parrafo_compromiso_pago", "cantidad_cuotas_intereses", "cantidad_cuotas_intereses_letras",
                         "cuota_intereses_monto", "cuota_intereses_monto_letras",
                         "fecha_primera_cuota_intereses_letras", "cuota_final_capital_monto",
                         "cuota_final_capital_letras", "fecha_cuota_final_capital_letras", "total_financiamiento",
                         "total_financiamiento_letras", "cliente_tratamiento", "cliente_nacionalidad",
                         "cliente_estado_civil", "cliente_ocupacion"],
    "entrega_voluntaria": ["cliente_cedula_letras", "cliente_nombre", "cliente_nacionalidad",
                           "cliente_estado_civil", "cliente_ocupacion", "cliente_direccion", "vehiculo_garantia",
                           "fecha_firma"],
    "acto_seguro": ["cliente_nombre", "vehiculo_garantia", "cantidad_cuotas_seguro", "fecha_firma",
                    "monto_total_seguro", "monto_total_seguro_letras", "cliente_cedula"],
    "pagare_seguro": ["cliente_nombre", "vehiculo_garantia", "cantidad_cuotas_seguro", "fecha_firma",
                      "monto_cuota_seguro", "monto_cuota_seguro_letras", "monto_total_seguro",
                      "monto_total_seguro_letras", "fecha_primera_cuota_seguro", "fecha_ultima_cuota_seguro"],
    "declaracion_jurada": ["cliente_nombre", "cliente_telefono", "cliente_correo", "cliente_origen_ingresos",
                           "fecha_contrato", "vehiculo_garantia", "fecha_firma", "cliente_nacionalidad",
                           "cliente_estado_civil", "cliente_ocupacion", "cliente_cedula_letras", "cliente_direccion"],
    "gps": ["cliente_nombre", "cliente_direccion", "vehiculo_garantia", "fecha_firma", "cliente_cedula_letras",
            "cliente_nacionalidad", "cliente_estado_civil", "cliente_ocupacion"],
    "autorizacion_data": ["cliente_nombre", "cliente_direccion", "cliente_direccion_transito", "vehiculo_garantia",
                          "fecha_firma"],
    "acuerdo_seguro": ["cliente_nombre", "cliente_cedula", "fecha_firma"],
    "autorizacion_asegurar_vehiculo": ["cliente_nombre", "cliente_cedula", "cliente_direccion", "vehiculo_garantia",
                                       "fecha_firma"],
    "autorizacion_desembolso": ["cliente_nombre", "cliente_cedula", "cliente_direccion", "vehiculo_garantia",
                                "fecha_firma", "monto_desembolso", "distribucion_desembolso"],
    "designacion_cuenta": ["cliente_nombre", "cliente_cedula", "cliente_direccion", "fecha_firma",
                           "monto_desembolso", "distribucion_desembolso"],
    "levantamiento_oposicion": ["cliente_nombre", "cliente_cedula", "cliente_direccion", "vehiculo_garantia"],
    "entrega_vehiculo": ["cliente_nombre_firma", "vehiculo_garantia", "fecha_firma", "operacion_referencia"],
    "entrega_vehiculo_fines_saldo": ["cliente_nombre", "vehiculo_garantia", "fecha_firma", "fecha_firma",
                                     "operacion_referencia"],
    "entrega_documentos": ["cliente_nombre", "cliente_cedula", "vehiculo_garantia", "operacion_referencia",
                           "fecha_contrato", "fecha_firma"],
    "carta_saldo": ["cliente_nombre", "cliente_cedula", "vehiculo_garantia", "operacion_referencia",
                    "fecha_contrato", "fecha_firma", "saldo_confirmado", "fecha_saldo"],
}

# Reviewed model key for each catalog type, when the portal has a reviewed body for it.
REVIEWED_MODEL = {
    "venta_condicional": "venta_condicional",
    "venta_condicional_seguro": "venta_condicional_seguro",
    "pagare_autentico": "pagare_autentico",
    "entrega_voluntaria": "entrega_voluntaria",
    "acto_seguro": "acto_seguro",
    "pagare_seguro": "pagare_seguro",
    "declaracion_jurada": "declaracion_jurada",
    "gps": "gps",
    "autorizacion_data": "autorizacion_data",
    "acuerdo_seguro": "acuerdo_seguro",
    "autorizacion_asegurar_vehiculo": "autorizacion_asegurar_vehiculo",
    "autorizacion_desembolso": "autorizacion_desembolso",
    "designacion_cuenta": "designacion_cuenta",
    "levantamiento_oposicion": "levantamiento_oposicion",
    "entrega_vehiculo": "entrega_vehiculo",
    "entrega_vehiculo_fines_saldo": "entrega_vehiculo_fines_saldo",
}

LAYOUT_BLOCKS = {
    "pagare_autentico": pagare_autentico_blocks,
    "entrega_voluntaria": entrega_voluntaria_blocks,
    "entrega_vehiculo": entrega_vehiculo_blocks,
    "acto_seguro": acto_seguro_blocks,
    "gps": gps_blocks,
    "declaracion_jurada": declaracion_jurada_blocks,
    "venta_condicional": venta_condicional_blocks,
}

# Per-type options of the portal's batch (`batch-document-generation.ts`).
TYPE_OPTIONS = {
    "venta_condicional": {"conditionalSale": "docx", "company": True},
    "venta_condicional_seguro": {"conditionalSale": "docx", "company": False},
    "pagare_autentico": {"boldPagareDate": True},
    "pagare_seguro": {"boldPagareDate": True, "company": False},
    "autorizacion_data": {"boldPagareDate": True},
    "levantamiento_oposicion": {"uppercase": True},
}
# The batch passes the company profile whenever the template has a catalog key (all reviewed
# models except the insurance sale, which the portal fills without it).
NO_COMPANY = {"venta_condicional_seguro", "pagare_seguro"}


def reviewed_case(type_id, pdf=False):
    model = REVIEWED_MODEL[type_id]
    options = dict(TYPE_OPTIONS.get(type_id, {}))
    blocks = company_filler(model)
    if pdf:
        options["conditionalSale"] = "pdf"
        blocks += venta_condicional_blocks(pdf=True)
    elif type_id in LAYOUT_BLOCKS:
        blocks += LAYOUT_BLOCKS[type_id]()
    if type_id == "venta_condicional_seguro":
        blocks += [text_para("Pagaré sintético de seguro.")]
    blocks += markers(TYPE_MARKERS[type_id])
    xml = document_xml(blocks)
    return model, xml, options


def plain_case(type_id):
    blocks = markers(TYPE_MARKERS[type_id])
    return document_xml(blocks), {}


def case_from(type_id, xml, options, reviewed, name=None):
    name = name or type_id
    keys = []
    for key in re.findall(r"\{\{([a-z][a-z0-9_]{0,63})\}\}", xml):
        if key not in keys:
            keys.append(key)
    occurrences = {key: len(re.findall(r"\{\{" + key + r"\}\}", xml)) for key in keys}
    parts = {"word/document.xml": xml}
    base.write_docx(base.HERE / "cases" / f"{name}.docx", parts)
    fields = [field_spec(key) for key in keys]
    values = {key: value_for(key) for key in keys}
    case = {
        "name": name,
        "docx": f"cases/{name}.docx",
        "variables": [{"key": key, "occurrences": occurrences[key]} for key in keys],
        "fields": fields,
        "values": values,
        "allowIncomplete": False,
        "uppercase": options.get("uppercase", False),
        "boldPagareDate": options.get("boldPagareDate", False),
        "expectError": False,
    }
    if "conditionalSale" in options:  # venta condicional and its insurance sale, as the batch passes them
        case["conditionalSale"] = options["conditionalSale"]
    if reviewed and type_id not in NO_COMPANY:
        case["company"] = {"name": COMPANY_NAME, "values": SYNTHETIC_COMPANY}
    if reviewed:
        case["vehicle"] = VEHICLE
    return case


def type_cases():
    cases = []
    reviewed = {}
    # The PDF variant of the sale: same reviewed body, with the layout the PDF branch rewrites.
    model, xml, options = reviewed_case("venta_condicional", pdf=True)
    reviewed[fingerprint(xml)] = model
    cases.append(case_from("venta_condicional", xml, options, True, name="venta_condicional_pdf"))
    for type_id in TYPE_MARKERS:
        if type_id in REVIEWED_MODEL:
            model, xml, options = reviewed_case(type_id)
            digest = fingerprint(xml)
            reviewed[digest] = model
            case = case_from(type_id, xml, options, True)
        else:
            xml, options = plain_case(type_id)
            case = case_from(type_id, xml, options, False)
        cases.append(case)
    return cases, reviewed
