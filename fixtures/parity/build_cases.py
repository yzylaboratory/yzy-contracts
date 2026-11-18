"""Builds synthetic .docx inputs and the shared case list for the Word fill parity suite.

Every value is synthetic. Outputs: cases/<name>.docx and cases.json (read by the
Node oracle in oracle/generate.mjs and by services/api/tests/document_fill_parity.rs).
"""
import json
import pathlib
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def run(text, bold=False):
    props = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:r>{props}<w:t xml:space="preserve">{text}</w:t></w:r>'


def para(*runs):
    return "<w:p>" + "".join(runs) + "</w:p>"


def field_runs(begin_result, instruction):
    return "".join([
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
        f'<w:r><w:instrText xml:space="preserve"> {instruction} </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
        run(begin_result),
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ])


def document(*blocks):
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{"".join(blocks)}'
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>'
    )


def header(body):
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="{W}" xmlns:r="{R}">{body}</w:hdr>'


def write_docx(path, parts):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        for name, xml in parts.items():
            archive.writestr(name, xml)


def field(key, label, kind="text", required=False, date_style=None):
    spec = {"key": key, "label": label, "kind": kind, "required": required}
    if date_style:
        spec["dateStyle"] = date_style
    return spec


def case(name, parts, variables, fields, values, **options):
    write_docx(HERE / "cases" / f"{name}.docx", parts)
    return {
        "name": name,
        "docx": f"cases/{name}.docx",
        "variables": [{"key": key, "occurrences": count} for key, count in variables],
        "fields": fields,
        "values": values,
        "allowIncomplete": options.get("allowIncomplete", False),
        "uppercase": options.get("uppercase", False),
        "boldPagareDate": options.get("boldPagareDate", False),
        "expectError": options.get("expectError", False),
    }


MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
PACKAGE_REPAIR_DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:mc="{MC}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
    'mc:Ignorable="w14 x9"><w:body>'
    '<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="0" w:after="120"/></w:pPr>'
    '<w:r><w:rPr><w:b/><w:rFonts w:ascii="Arial"/></w:rPr><w:t>Cliente: {{cliente_nombre}}</w:t></w:r></w:p>'
    '<w:p><w:r><w:rPr><w:b/><w:b/><w:i/></w:rPr><w:t>Fin {{cliente_nombre}}</w:t></w:r></w:p>'
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>'
)


def main():
    (HERE / "cases").mkdir(exist_ok=True)
    cases = []

    cases.append(case("split_marker", {"word/document.xml": document(
        para(run("Cliente: {{cli"), run("ente_nombre}}."), run(" Firmado."))
    )}, [("cliente_nombre", 1)], [field("cliente_nombre", "Nombre")], {"cliente_nombre": "Ana Pérez"}))

    cases.append(case("repeated_and_rd", {"word/document.xml": document(
        para(run("Monto: RD${{monto_desembolso}} para {{cliente_nombre}} y {{cliente_nombre}}."))
    )}, [("monto_desembolso", 1), ("cliente_nombre", 2)],
        [field("monto_desembolso", "Monto", "money"), field("cliente_nombre", "Nombre")],
        {"monto_desembolso": "RD$25,000.00", "cliente_nombre": "Luis Mora"}))

    cases.append(case("address_bold_uppercase_text", {"word/document.xml": document(
        para(run("Domicilio: {{cliente_direccion}}.")),
        para(run("Ciudad: {{cliente_ciudad}}"))
    )}, [("cliente_direccion", 1), ("cliente_ciudad", 1)],
        [field("cliente_direccion", "Dirección"), field("cliente_ciudad", "Ciudad")],
        {"cliente_direccion": "calle 1, santiago", "cliente_ciudad": "santiago"}, uppercase=True))

    cases.append(case("pagare_dates_bold", {"word/document.xml": document(
        para(run("Fecha: {{fecha_firma}}")),
        para(run("Acto: {{fecha_de_firma}}"))
    )}, [("fecha_firma", 1), ("fecha_de_firma", 1)],
        [field("fecha_firma", "Fecha de firma", "date", True, "long"),
         field("fecha_de_firma", "Fecha del acto", "date", True, "notarialAct")],
        {"fecha_firma": "2026-11-16", "fecha_de_firma": "2026-10-13"}, boldPagareDate=True))

    cases.append(case("payment_columns_multiline", {"word/document.xml": document(
        para(run("Montos: {{cuotas_intereses_montos}}")),
        para(run("Numeros: {{cuotas_intereses_numeros}}"))
    )}, [("cuotas_intereses_montos", 1), ("cuotas_intereses_numeros", 1)],
        [field("cuotas_intereses_montos", "Montos"), field("cuotas_intereses_numeros", "Números")],
        {"cuotas_intereses_montos": "RD$100.00\nRD$200.00", "cuotas_intereses_numeros": "1\n2"}))

    cases.append(case("vehicle_identifier_lines", {"word/document.xml": document(
        para(run("NO. DE REGISTRO Y PLACA: {{vehiculo_matricula}}")),
        para(run("MOTOR O NO. DE SERIE:{{numero_de_serie_del_motor}}"))
    )}, [("vehiculo_matricula", 1), ("numero_de_serie_del_motor", 1)],
        [field("vehiculo_matricula", "Placa"), field("numero_de_serie_del_motor", "Motor")],
        {"vehiculo_matricula": "", "numero_de_serie_del_motor": ""}, allowIncomplete=True))

    cases.append(case("protected_and_field_results", {"word/document.xml": document(
        para(field_runs("Resultado de campo", "MERGEFIELD nombre"), run(" {{cliente_nombre}}")),
        '<w:p><w:ins w:id="1" w:author="Sintetico" w:date="2026-01-01T00:00:00Z">'
        + run("Texto insertado") + "</w:ins>" + run(" {{cliente_nombre}}") + "</w:p>"
    )}, [("cliente_nombre", 2)], [field("cliente_nombre", "Nombre")], {"cliente_nombre": "Carla Díaz"}))

    cases.append(case("header_part_and_body", {
        "word/document.xml": document(para(run("Cuerpo: {{cliente_nombre}}"))),
        "word/header1.xml": header(para(run("Encabezado: {{cliente_nombre}}"))),
    }, [("cliente_nombre", 2)], [field("cliente_nombre", "Nombre")], {"cliente_nombre": "Pedro Gil"}))

    cases.append(case("incomplete_required_allowed", {"word/document.xml": document(
        para(run("Dato: [{{cliente_telefono}}] fin"))
    )}, [("cliente_telefono", 1)], [field("cliente_telefono", "Teléfono", "phone", True)],
        {}, allowIncomplete=True))

    cases.append(case("identity_and_nationality", {"word/document.xml": document(
        para(run("Cédula {{cliente_cedula}}, nacionalidad {{cliente_nacionalidad}}."))
    )}, [("cliente_cedula", 1), ("cliente_nacionalidad", 1)],
        [field("cliente_cedula", "Cédula", "identity"), field("cliente_nacionalidad", "Nacionalidad")],
        {"cliente_cedula": "40212345678", "cliente_nacionalidad": "DOMINICANO"}))

    cases.append(case("final_capital_numeric_date", {"word/document.xml": document(
        para(run("Capital el {{fecha_cuota_final_capital}}"))
    )}, [("fecha_cuota_final_capital", 1)],
        [field("fecha_cuota_final_capital", "Fecha", "date", True)],
        {"fecha_cuota_final_capital": "2027-01-05"}))

    cases.append(case("line_breaks_collapse", {"word/document.xml": document(
        para(run("{{cliente_nombre}}"))
    )}, [("cliente_nombre", 1)], [field("cliente_nombre", "Nombre")],
        {"cliente_nombre": "Ana\tPérez\nLínea dos"}))

    cases.append(case("bare_brace_is_rejected", {"word/document.xml": document(
        para(run("Texto {{ suelto {{cliente_nombre}}"))
    )}, [("cliente_nombre", 1)], [field("cliente_nombre", "Nombre")],
        {"cliente_nombre": "Ana"}, expectError=True))

    cases.append(case("package_repairs", {
        "word/document.xml": PACKAGE_REPAIR_DOCUMENT,
        "word/fontTable.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:fonts xmlns:w="{W}"><w:font w:name="Arial"><w:charset w:val="00" w:characterSet="utf-8"/></w:font></w:fonts>',
        "docProps/app.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        "<Application>Sintetico</Application><HeadingPairs/><TitlesOfParts/></Properties>",
        "docProps/custom.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">'
        '<property/><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Sintetico">'
        '<vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">x</vt:lpwstr>'
        "</property></Properties>",
    }, [("cliente_nombre", 2)], [field("cliente_nombre", "Nombre")], {"cliente_nombre": "Rosa Ruiz"}))

    import build_type_cases

    type_list, reviewed = build_type_cases.type_cases()
    cases.extend(type_list)
    (HERE / "cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (HERE / "reviewed_bodies.json").write_text(json.dumps(reviewed, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(cases)} cases written, {len(reviewed)} reviewed bodies")


if __name__ == "__main__":
    main()
