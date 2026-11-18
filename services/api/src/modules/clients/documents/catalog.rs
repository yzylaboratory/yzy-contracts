//! Document types and compatibility rules from the portal's document catalog.
use super::fields::normalized_words;
use crate::modules::templates::NativeVariable;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum CaseDocumentType {
    VentaCondicional,
    VentaCondicionalSeguro,
    PagareAutentico,
    EntregaVoluntaria,
    ActoSeguro,
    PagareSeguro,
    DeclaracionJurada,
    Gps,
    AutorizacionData,
    AcuerdoSeguro,
    AutorizacionAsegurarVehiculo,
    AutorizacionDesembolso,
    DesignacionCuenta,
    LevantamientoOposicion,
    EntregaVehiculo,
    EntregaVehiculoFinesSaldo,
    EntregaDocumentos,
    CartaSaldo,
}
use CaseDocumentType::*;

pub(super) const TYPES: &[CaseDocumentType] = &[
    VentaCondicional,
    VentaCondicionalSeguro,
    PagareAutentico,
    EntregaVoluntaria,
    ActoSeguro,
    PagareSeguro,
    DeclaracionJurada,
    Gps,
    AutorizacionData,
    AcuerdoSeguro,
    AutorizacionAsegurarVehiculo,
    AutorizacionDesembolso,
    DesignacionCuenta,
    LevantamientoOposicion,
    EntregaVehiculo,
    EntregaVehiculoFinesSaldo,
    EntregaDocumentos,
    CartaSaldo,
];

impl CaseDocumentType {
    pub(super) fn key(self) -> &'static str {
        match self {
            VentaCondicional => "venta_condicional",
            VentaCondicionalSeguro => "venta_condicional_seguro",
            PagareAutentico => "pagare_autentico",
            EntregaVoluntaria => "entrega_voluntaria",
            ActoSeguro => "acto_seguro",
            PagareSeguro => "pagare_seguro",
            DeclaracionJurada => "declaracion_jurada",
            Gps => "gps",
            AutorizacionData => "autorizacion_data",
            AcuerdoSeguro => "acuerdo_seguro",
            AutorizacionAsegurarVehiculo => "autorizacion_asegurar_vehiculo",
            AutorizacionDesembolso => "autorizacion_desembolso",
            DesignacionCuenta => "designacion_cuenta",
            LevantamientoOposicion => "levantamiento_oposicion",
            EntregaVehiculo => "entrega_vehiculo",
            EntregaVehiculoFinesSaldo => "entrega_vehiculo_fines_saldo",
            EntregaDocumentos => "entrega_documentos",
            CartaSaldo => "carta_saldo",
        }
    }
}
impl CaseDocumentType {
    pub(super) fn label(self) -> &'static str {
        match self {
            VentaCondicional => "CONTRATO DE VENTA CONDICIONAL DE MUEBLES",
            VentaCondicionalSeguro => "Venta condicional de seguro",
            PagareAutentico => "Pagaré auténtico notarial",
            EntregaVoluntaria => "Entrega voluntaria",
            ActoSeguro => "CONTRATO DE VENTA CONDICIONAL DE MUEBLES (SEGURO)",
            PagareSeguro => "Pagaré auténtico notarial (SEGURO)",
            DeclaracionJurada => "DECLARACION JURADA DE PERSONA FISICA",
            Gps => "CONTRATO DE ACUERDO ENTRE LAS PARTES - GPS",
            AutorizacionData => "Autorización de revisión del buró de crédito",
            AcuerdoSeguro => "Acuerdo de renovación anual de seguro",
            AutorizacionAsegurarVehiculo => "Carta de autorización para asegurar vehículo",
            AutorizacionDesembolso => "Autorización de desembolso",
            DesignacionCuenta => "Designación de cuenta",
            LevantamientoOposicion => "PODER ESPECIAL PARA LEVANTAMIENTO DE OPOSICION EN LA DGII",
            EntregaVehiculo => "Entrega de vehículo",
            EntregaVehiculoFinesSaldo => "Entrega de vehículo con fines de saldo",
            EntregaDocumentos => "Entrega de documentos",
            CartaSaldo => "Carta de saldo",
        }
    }
}
impl CaseDocumentType {
    pub(super) fn required(self) -> &'static [&'static str] {
        match self {
            VentaCondicional => &[
                "vehiculo_matricula",
                "fecha_firma",
                "cuotas_intereses",
                "cuota_final_capital",
                "total_financiamiento",
            ],
            VentaCondicionalSeguro => &[
                "fecha_de_firma",
                "placa_del_vehiculo",
                "fecha_de_vencimiento_de_la_cuota_1",
                "fecha_de_vencimiento_de_la_cuota_2",
                "fecha_de_vencimiento_de_la_cuota_3",
                "fecha_de_vencimiento_de_la_cuota_4",
                "fecha_de_vencimiento_de_la_cuota_5",
                "fecha_de_vencimiento_de_la_cuota_6",
                "fecha_de_vencimiento_de_la_cuota_7",
                "fecha_de_vencimiento_de_la_cuota_8",
                "fecha_de_vencimiento_de_la_cuota_9",
                "fecha_de_vencimiento_de_la_cuota_10",
                "monto_de_cada_cuota",
                "monto_total_financiado",
                "monto_total_financiado_en_letras",
            ],
            PagareAutentico => &[
                "cliente_nombre",
                "cliente_cedula",
                "cliente_cedula_letras",
                "cliente_direccion",
                "vehiculo_garantia",
                "fecha_firma",
                "parrafo_compromiso_pago",
                "cantidad_cuotas_intereses",
                "cantidad_cuotas_intereses_letras",
                "cuota_intereses_monto",
                "cuota_intereses_monto_letras",
                "fecha_primera_cuota_intereses_letras",
                "cuota_final_capital_monto",
                "cuota_final_capital_letras",
                "fecha_cuota_final_capital_letras",
                "total_financiamiento",
                "total_financiamiento_letras",
                "testigo_richard",
                "testigo_usuario",
            ],
            EntregaVoluntaria => &[
                "cliente_nombre",
                "cliente_cedula",
                "cliente_cedula_letras",
                "vehiculo_garantia",
                "fecha_firma",
            ],
            ActoSeguro => &[
                "cliente_nombre",
                "vehiculo_garantia",
                "cantidad_cuotas_seguro",
                "fecha_firma",
                "cuotas_seguro_numeros",
                "cuotas_seguro_fechas",
                "cuotas_seguro_montos",
                "monto_total_seguro",
                "monto_total_seguro_letras",
            ],
            PagareSeguro => &[
                "cliente_nombre",
                "vehiculo_garantia",
                "cantidad_cuotas_seguro",
                "fecha_firma",
            ],
            DeclaracionJurada => &[
                "cliente_nombre",
                "cliente_cedula",
                "cliente_telefono",
                "cliente_correo",
                "cliente_origen_ingresos",
                "fecha_contrato",
                "vehiculo_garantia",
                "fecha_firma",
            ],
            Gps => &[
                "cliente_nombre",
                "cliente_direccion",
                "vehiculo_garantia",
                "fecha_firma",
            ],
            AutorizacionData => &[
                "cliente_nombre",
                "cliente_direccion",
                "vehiculo_garantia",
                "fecha_firma",
            ],
            AcuerdoSeguro => &["cliente_nombre", "cliente_cedula", "fecha_firma"],
            AutorizacionAsegurarVehiculo => &[
                "cliente_nombre",
                "cliente_cedula",
                "cliente_direccion",
                "vehiculo_garantia",
                "fecha_firma",
            ],
            AutorizacionDesembolso => &[
                "cliente_nombre",
                "cliente_cedula",
                "cliente_direccion",
                "vehiculo_garantia",
                "fecha_firma",
                "monto_desembolso",
                "distribucion_desembolso",
            ],
            DesignacionCuenta => &[
                "cliente_nombre",
                "cliente_cedula",
                "cliente_direccion",
                "fecha_firma",
                "monto_desembolso",
                "distribucion_desembolso",
            ],
            LevantamientoOposicion => &[
                "cliente_nombre",
                "cliente_cedula",
                "cliente_direccion",
                "vehiculo_garantia",
            ],
            EntregaVehiculo => &[
                "cliente_nombre",
                "cliente_cedula",
                "vehiculo_garantia",
                "fecha_firma",
            ],
            EntregaVehiculoFinesSaldo => &[
                "cliente_nombre",
                "cliente_cedula",
                "vehiculo_garantia",
                "fecha_firma",
            ],
            EntregaDocumentos => &[
                "cliente_nombre",
                "cliente_cedula",
                "vehiculo_garantia",
                "operacion_referencia",
                "fecha_contrato",
                "fecha_firma",
            ],
            CartaSaldo => &[
                "cliente_nombre",
                "cliente_cedula",
                "vehiculo_garantia",
                "operacion_referencia",
                "fecha_contrato",
                "fecha_firma",
                "saldo_confirmado",
                "fecha_saldo",
            ],
        }
    }
}
pub(super) const LEGACY_CASE_FIELDS: &[(&str, &str)] = &[
    ("fecha_de_firma", "fecha_firma"),
    ("nombre_completo_del_cliente", "cliente_nombre"),
    ("nacionalidad_del_cliente", "cliente_nacionalidad"),
    ("ocupacion_del_cliente", "cliente_ocupacion"),
    ("cedula_del_cliente", "cliente_cedula"),
    ("domicilio_del_cliente", "cliente_direccion"),
    ("tipo_del_vehiculo", "vehiculo_tipo"),
    ("marca_del_vehiculo", "vehiculo_marca"),
    ("modelo_del_vehiculo", "vehiculo_modelo"),
    ("anio_del_vehiculo", "vehiculo_anio"),
    ("color_del_vehiculo", "vehiculo_color"),
    ("placa_del_vehiculo", "vehiculo_placa"),
    ("numero_de_chasis_del_vehiculo", "vehiculo_chasis"),
    ("numero_de_serie_del_motor", "vehiculo_motor"),
];

impl CaseDocumentType {
    pub(super) fn insurance(self) -> bool {
        matches!(
            self,
            VentaCondicionalSeguro
                | ActoSeguro
                | PagareSeguro
                | AcuerdoSeguro
                | AutorizacionAsegurarVehiculo
        )
    }

    pub(super) fn requires_issuer(self) -> bool {
        matches!(self, VentaCondicionalSeguro | ActoSeguro | PagareSeguro)
    }

    pub(super) fn disbursement(self) -> bool {
        matches!(self, AutorizacionDesembolso | DesignacionCuenta)
    }

    pub(super) fn conditional_sale(self) -> bool {
        matches!(self, VentaCondicional | VentaCondicionalSeguro)
    }

    pub(super) fn uppercase(self) -> bool {
        self == LevantamientoOposicion
    }

    pub(super) fn notarial(self) -> bool {
        matches!(
            self,
            PagareAutentico
                | PagareSeguro
                | ActoSeguro
                | EntregaVoluntaria
                | DeclaracionJurada
                | VentaCondicionalSeguro
                | AutorizacionData
                | Gps
        )
    }

    pub(super) fn notarial_payment(self) -> bool {
        matches!(self, PagareAutentico | PagareSeguro)
    }

    pub(super) fn bold_date(self) -> bool {
        matches!(self, PagareAutentico | PagareSeguro | AutorizacionData)
    }

    fn has_fields(self, variables: &[NativeVariable]) -> bool {
        let has = |key: &str| variables.iter().any(|variable| variable.key == key);
        self.required().iter().all(|key| {
            has(key) || (!aliases(key).is_empty() && aliases(key).iter().all(|key| has(key)))
        })
    }
}

pub(super) fn aliases(key: &str) -> &'static [&'static str] {
    match key {
        "cliente_cedula" => &["cliente_cedula_numeros"],
        "cliente_direccion" => &["cliente_direccion_transito"],
        "vehiculo_garantia" => &["vehiculo_descripcion"],
        "vehiculo_matricula" => &["vehiculo_placa"],
        "cuotas_intereses" => &[
            "cuotas_intereses_numeros",
            "cuotas_intereses_fechas",
            "cuotas_intereses_montos",
        ],
        "cuota_final_capital" => &[
            "numero_cuota_final_capital",
            "fecha_cuota_final_capital",
            "cuota_final_capital_monto",
        ],
        _ => &[],
    }
}

fn by_name(name: &str) -> Option<CaseDocumentType> {
    let base = if name.to_ascii_lowercase().ends_with(".docx") {
        &name[..name.len() - 5]
    } else {
        name
    };
    let normalized = normalized_words(base);
    Some(match normalized.as_str() {
        "venta condicional de vehiculo con financiamiento de seguro"
        | "venta condicional del seguro" => VentaCondicionalSeguro,
        "autorizacion de datos" => AutorizacionData,
        "levantamiento de oposicion" => LevantamientoOposicion,
        "pagare de seguro" => PagareSeguro,
        "acuerdo de seguro" => AcuerdoSeguro,
        "autorizacion para asegurar vehiculo"
        | "carta de autorizacion para asegurar vehiculo"
        | "autorizacion para asegurar el vehiculo" => AutorizacionAsegurarVehiculo,
        "pagare autentico" | "pagare autentico notarial" | "pagare notarial" => PagareAutentico,
        _ => {
            return TYPES.iter().copied().find(|kind| {
                normalized_words(kind.label()) == normalized
                    || normalized_words(kind.key()) == normalized
            });
        }
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TemplateMatch {
    Official,
    Matching,
    Compatible,
}

pub(super) fn template_match(
    kind: CaseDocumentType,
    name: &str,
    catalog_key: Option<&str>,
    variables: &[NativeVariable],
) -> Option<TemplateMatch> {
    if !kind.has_fields(variables) {
        return None;
    }
    if let Some(key) = catalog_key {
        return (key == kind.key()).then_some(TemplateMatch::Official);
    }
    let named = by_name(name);
    if named.is_some_and(|named| named != kind) {
        return None;
    }
    if named.is_some()
        || TYPES
            .iter()
            .filter(|kind| kind.has_fields(variables))
            .count()
            == 1
    {
        Some(TemplateMatch::Matching)
    } else {
        Some(TemplateMatch::Compatible)
    }
}
