//! Reviewed Word bodies: the portal fills them with dedicated reference values, company
//! paragraph ranges and layouts (`reference-word.ts`, `reviewed-word-layout.ts`).
//! The body is identified by the SHA-256 of `word/document.xml`, as the portal does.

use super::tables::REVIEWED_BODIES;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewedModel {
    ActoSeguro,
    AcuerdoSeguro,
    AutorizacionAsegurarVehiculo,
    AutorizacionData,
    AutorizacionDesembolso,
    DeclaracionJurada,
    DesignacionCuenta,
    EntregaVehiculo,
    EntregaVehiculoFinesSaldo,
    EntregaVoluntaria,
    Gps,
    LevantamientoOposicion,
    PagareAutentico,
    PagareSeguro,
    VentaCondicional,
    VentaCondicionalSeguro,
}

impl ReviewedModel {
    /// Every reviewed model, in the order of the portal's `referenceBodies`.
    pub const ALL: [Self; 16] = [
        Self::ActoSeguro,
        Self::AcuerdoSeguro,
        Self::AutorizacionAsegurarVehiculo,
        Self::AutorizacionData,
        Self::AutorizacionDesembolso,
        Self::DeclaracionJurada,
        Self::DesignacionCuenta,
        Self::EntregaVehiculo,
        Self::EntregaVehiculoFinesSaldo,
        Self::EntregaVoluntaria,
        Self::Gps,
        Self::LevantamientoOposicion,
        Self::PagareAutentico,
        Self::PagareSeguro,
        Self::VentaCondicional,
        Self::VentaCondicionalSeguro,
    ];

    /// The model for a portal key such as `pagare_autentico`.
    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|model| model.as_str() == key)
    }

    /// The portal's model key, as used in `reviewedWordLayout` and `referenceBodies`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ActoSeguro => "acto_seguro",
            Self::AcuerdoSeguro => "acuerdo_seguro",
            Self::AutorizacionAsegurarVehiculo => "autorizacion_asegurar_vehiculo",
            Self::AutorizacionData => "autorizacion_data",
            Self::AutorizacionDesembolso => "autorizacion_desembolso",
            Self::DeclaracionJurada => "declaracion_jurada",
            Self::DesignacionCuenta => "designacion_cuenta",
            Self::EntregaVehiculo => "entrega_vehiculo",
            Self::EntregaVehiculoFinesSaldo => "entrega_vehiculo_fines_saldo",
            Self::EntregaVoluntaria => "entrega_voluntaria",
            Self::Gps => "gps",
            Self::LevantamientoOposicion => "levantamiento_oposicion",
            Self::PagareAutentico => "pagare_autentico",
            Self::PagareSeguro => "pagare_seguro",
            Self::VentaCondicional => "venta_condicional",
            Self::VentaCondicionalSeguro => "venta_condicional_seguro",
        }
    }

    /// `boldFields` of `reviewedWordLayout`. Models without a layout entry bold nothing.
    pub fn bold_fields(self) -> &'static [&'static str] {
        match self {
            Self::PagareAutentico
            | Self::PagareSeguro
            | Self::EntregaVehiculo
            | Self::DeclaracionJurada => &["fecha_firma"],
            Self::AutorizacionData => &[
                "cliente_direccion",
                "cliente_direccion_transito",
                "empresa_direccion",
                "fecha_firma",
            ],
            Self::ActoSeguro => &["fecha_firma", "cuotas_seguro_fechas"],
            Self::Gps => &["fecha_firma", "empresa_direccion"],
            Self::VentaCondicionalSeguro => &[
                "fecha_de_firma",
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
            ],
            Self::EntregaVoluntaria | Self::VentaCondicional => &[],
            Self::AcuerdoSeguro
            | Self::AutorizacionAsegurarVehiculo
            | Self::AutorizacionDesembolso
            | Self::DesignacionCuenta
            | Self::EntregaVehiculoFinesSaldo
            | Self::LevantamientoOposicion => &[],
        }
    }
}

/// Identifies a reviewed body by the SHA-256 of its `word/document.xml`.
pub(crate) fn identify(table: &[(&str, ReviewedModel)], digest: &str) -> Option<ReviewedModel> {
    table
        .iter()
        .find(|(known, _)| *known == digest)
        .map(|(_, model)| *model)
}

/// The production table, generated from `reference-word.ts`.
pub fn production_table() -> &'static [(&'static str, ReviewedModel)] {
    REVIEWED_BODIES
}
