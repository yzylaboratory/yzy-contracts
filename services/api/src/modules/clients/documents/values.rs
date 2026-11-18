//! Expediente values and issues, following expediente-fields.ts.
use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

use chrono::{Datelike, Months, NaiveDate};
use regex::Regex;
use serde::Serialize;
use utoipa::ToSchema;

use crate::{
    error::ApiError,
    modules::companies::MAX_VALUE_CHARACTERS,
    modules::document_fill::{
        CompanyProfile, Vehicle,
        format::{
            DateStyle, format_date, identity_with_dashes, integer_words, parse_calendar_date,
            strip_marks,
        },
        reference::{cedula_words, company_profile_value, expediente_vehicle_description},
    },
};

use super::{
    catalog::{CaseDocumentType, CaseDocumentType::*, LEGACY_CASE_FIELDS},
    fields::{label, normalized_words},
};
use crate::modules::clients::dto::{
    CalendarDate, Client, Financing, Operation, Payment, VehicleDocument,
};

pub(super) type Values = HashMap<String, String>;
const MAX_SAFE: i64 = 9_007_199_254_740_991;
pub(super) const ANCHOR: &str = "fecha_ancla_cuota_extraordinaria";
const INSURANCE_SALE_COUNT: u32 = 10;
pub(super) const INSURER: &str = "INVERSIONES MARTÍNEZ ROSARIO, S.R.L.";

#[derive(Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum OperatorFieldKind {
    Text,
    Money,
    Date,
}

#[derive(Clone, Copy, Serialize, ToSchema)]
pub(super) struct OperatorField {
    key: &'static str,
    label: &'static str,
    kind: OperatorFieldKind,
    #[schema(example = true)]
    required: bool,
}

pub(super) fn operator_fields(kind: CaseDocumentType) -> &'static [OperatorField] {
    const DISTRIBUTION: &[OperatorField] = &[OperatorField {
        key: "distribucion_desembolso",
        label: "Distribución del desembolso",
        kind: OperatorFieldKind::Text,
        required: true,
    }];
    const BALANCE: &[OperatorField] = &[
        OperatorField {
            key: "saldo_confirmado",
            label: "Saldo confirmado (RD$)",
            kind: OperatorFieldKind::Money,
            required: true,
        },
        OperatorField {
            key: "fecha_saldo",
            label: "Fecha del saldo confirmado",
            kind: OperatorFieldKind::Date,
            required: true,
        },
    ];
    if kind.disbursement() {
        DISTRIBUTION
    } else if kind == CartaSaldo {
        BALANCE
    } else {
        &[]
    }
}

#[derive(Default)]
pub(super) struct OperatorValues<'a> {
    distribution: Option<&'a str>,
    balance_minor: Option<i64>,
    balance_date: Option<NaiveDate>,
}

pub(super) fn normalize_operator_values(
    kind: CaseDocumentType,
    values: &BTreeMap<String, String>,
) -> Result<OperatorValues<'_>, ApiError> {
    let fields = operator_fields(kind);
    if let Some(key) = values
        .keys()
        .find(|key| !fields.iter().any(|field| field.key == *key))
    {
        return Err(ApiError::Validation(format!(
            "El campo «{key}» no corresponde a este tipo de documento."
        )));
    }
    let mut result = OperatorValues::default();
    for field in fields {
        let invalid =
            || ApiError::Validation(format!("Falta o es inválido el campo «{}».", field.label));
        let value = values
            .get(field.key)
            .map(|value| js_trim(value))
            .filter(|value| !value.is_empty())
            .ok_or_else(invalid)?;
        match field.kind {
            OperatorFieldKind::Text => {
                if value.chars().count() > MAX_VALUE_CHARACTERS {
                    return Err(ApiError::Validation(format!(
                        "El valor de «{}» supera el máximo de {MAX_VALUE_CHARACTERS} caracteres.",
                        field.label
                    )));
                }
                result.distribution = Some(value);
            }
            OperatorFieldKind::Money => {
                result.balance_minor = Some(parse_amount_minor(value).ok_or_else(invalid)?)
            }
            OperatorFieldKind::Date => {
                result.balance_date = Some(parse_calendar_date(value).ok_or_else(invalid)?)
            }
        }
    }
    Ok(result)
}

fn js_trim(value: &str) -> &str {
    value.trim_matches(|ch: char| ch == '\u{feff}' || (ch.is_whitespace() && ch != '\u{0085}'))
}

/// parseAmountMinor in clientes/amount-input.ts (including the es-DO ambiguity rule).
fn parse_amount_minor(value: &str) -> Option<i64> {
    static GROUP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r",[0-9]{3}(?:,|$)").unwrap());
    let normalized = if value.starts_with("RD$") || value.contains('.') || GROUP.is_match(value) {
        value
            .strip_prefix("RD$")
            .map_or(value, |rest| {
                rest.trim_start_matches(|ch: char| {
                    ch == '\u{feff}' || (ch.is_whitespace() && ch != '\u{0085}')
                })
            })
            .replace(',', "")
    } else {
        value.replacen(',', ".", 1)
    };
    let (whole, fraction) = normalized.split_once('.').unwrap_or((&normalized, ""));
    if whole.is_empty()
        || fraction.len() > 2
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let cents = fraction.parse::<i64>().unwrap_or(0) * if fraction.len() == 1 { 10 } else { 1 };
    whole
        .parse::<i64>()
        .ok()?
        .checked_mul(100)?
        .checked_add(cents)
        .filter(|&minor| is_safe(minor))
}

pub(super) fn is_safe(value: i64) -> bool {
    (0..=MAX_SAFE).contains(&value)
}

pub(super) fn count_words(count: i64) -> String {
    strip_marks(&integer_words(count as u64, false)).to_uppercase()
}

fn money_number(minor: i64) -> String {
    let whole = (minor / 100).to_string();
    let mut money = String::from("RD$");
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index).is_multiple_of(3) {
            money.push(',');
        }
        money.push(digit);
    }
    money.push_str(&format!(".{:02}", minor % 100));
    money
}

pub(super) fn notarial_money_words(minor: i64) -> String {
    let pesos = minor / 100;
    let currency = if pesos == 1 { "PESO" } else { "PESOS" };
    let connector = if pesos > 0 && pesos % 1_000_000 == 0 {
        " DE "
    } else {
        " "
    };
    let words = integer_words(pesos as u64, true);
    strip_marks(&format!(
        "{words}{connector}{currency} CON {:02}/100 CENTAVOS DOMINICANOS",
        minor % 100
    ))
    .to_uppercase()
}

fn notarial_money(minor: i64) -> String {
    format!("{} ({})", notarial_money_words(minor), money_number(minor))
}

fn add_months(date: NaiveDate, months: u32) -> Option<NaiveDate> {
    date.checked_add_months(Months::new(months))
        .filter(|date| (1..=9999).contains(&date.year()))
}

fn opt_date(date: Option<NaiveDate>) -> String {
    date.filter(|date| (1..=9999).contains(&date.year()))
        .map(|date| date.to_string())
        .unwrap_or_default()
}

fn text(value: Option<&str>) -> String {
    value.map(js_trim).unwrap_or("").to_owned()
}

pub(super) fn vehicle_from_case(operation: &Operation) -> Vehicle {
    let vehicle = &operation.vehicle;
    Vehicle {
        vehicle_type: vehicle.vehicle_type.clone(),
        make: vehicle.make.clone(),
        model: vehicle.model.clone(),
        year: vehicle.year.clone(),
        color: vehicle.color.clone(),
        registration_number: vehicle.registration_number.clone(),
        chassis_number: vehicle.chassis_number.clone(),
        plate: vehicle.plate.clone(),
        engine_number: vehicle.engine_number.clone(),
    }
}

fn valid_payment(payment: &Payment) -> bool {
    (1..=MAX_SAFE).contains(&payment.amount_minor) && (1..=9999).contains(&payment.date.0.year())
}

fn payment_amount(minor: i64, words: bool) -> String {
    if words {
        notarial_money(minor)
    } else {
        money_number(minor)
    }
}

fn payment_text(payment: &Payment, words: bool) -> String {
    let style = if words {
        DateStyle::Notarial
    } else {
        DateStyle::Long
    };
    format!(
        "{}, {}",
        format_date(payment.date.0, style),
        payment_amount(payment.amount_minor, words)
    )
}

fn schedule_text(payments: &[Payment], words: bool) -> String {
    payments
        .iter()
        .enumerate()
        .map(|(index, pay)| format!("{}) {}", index + 1, payment_text(pay, words)))
        .collect::<Vec<_>>()
        .join(". ")
}

fn valid_legacy_extras(payments: &[Payment]) -> bool {
    payments.iter().enumerate().all(|(index, pay)| {
        valid_payment(pay)
            && u32::try_from(index)
                .ok()
                .and_then(|index| index.checked_mul(4))
                .and_then(|months| add_months(payments[0].date.0, months))
                == Some(pay.date.0)
    })
}

fn signature_extras(financing: &Financing, signature: NaiveDate) -> Vec<Payment> {
    let saved = &financing.extraordinary_payments;
    let reusable = if financing.extraordinary_from_signature || valid_legacy_extras(saved) {
        saved.as_slice()
    } else {
        &[]
    };
    let last_funded = reusable
        .iter()
        .rposition(|payment| payment.amount_minor > 0)
        .map_or(0, |index| index + 1);
    let count = financing
        .extraordinary_payment_count
        .unwrap_or(last_funded)
        .max(2);
    (4..1200)
        .step_by(4)
        .map_while(|months| add_months(signature, months))
        .take_while(|date| *date < financing.final_principal.date.0)
        .take(count)
        .enumerate()
        .map(|(index, date)| Payment {
            date: CalendarDate(date),
            amount_minor: reusable
                .get(index)
                .map_or(0, |payment| payment.amount_minor),
        })
        .collect()
}

impl CaseValues {
    fn put(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.values.insert(key.into(), value.into());
    }

    pub(super) fn get(&self, key: &str) -> &str {
        self.values.get(key).map(String::as_str).unwrap_or("")
    }

    fn add_extra_payments(&mut self, payments: &[Payment], words: bool) {
        self.put(
            "abonos_extraordinarios",
            if payments.is_empty() {
                "Ninguno".into()
            } else {
                schedule_text(payments, words)
            },
        );
        for (index, payment) in payments.iter().enumerate() {
            self.put(
                format!("fecha_abono_extraordinario_{}", index + 1),
                payment.date.0.to_string(),
            );
            self.put(
                format!("abono_extraordinario_{}_monto", index + 1),
                money_number(payment.amount_minor),
            );
        }
    }

    fn add_financing(&mut self, financing: &Financing, words: bool) {
        let interest = &financing.interest_installments;
        let capital = &financing.final_principal;
        let extras = &financing.extraordinary_payments;
        if valid_payment(capital) {
            self.put("cuota_final_capital", payment_text(capital, words));
            self.put("fecha_cuota_final_capital", capital.date.0.to_string());
            self.put(
                "cuota_final_capital_monto",
                money_number(capital.amount_minor),
            );
            self.put(
                "cuota_final_capital_letras",
                notarial_money_words(capital.amount_minor),
            );
            self.put(
                "fecha_cuota_final_capital_letras",
                format_date(capital.date.0, DateStyle::Notarial),
            );
            self.put("monto_desembolso", notarial_money(capital.amount_minor));
        }
        let interest_valid = interest.iter().enumerate().all(|(index, pay)| {
            valid_payment(pay)
                && pay.date.0 < capital.date.0
                && (index == 0 || pay.date.0 > interest[index - 1].date.0)
        });
        if interest_valid {
            self.add_interest(interest, capital, words);
        }
        if valid_legacy_extras(extras) {
            self.add_extra_payments(extras, words);
        }
    }

    fn add_interest(&mut self, interest: &[Payment], capital: &Payment, words: bool) {
        let count = interest.len() as i64;
        let uniform = interest
            .first()
            .map(|pay| pay.amount_minor)
            .filter(|&first| interest.iter().all(|pay| pay.amount_minor == first));
        let schedule = if let Some(amount) = uniform.filter(|_| words && count > 1) {
            let dates: Vec<_> = interest
                .iter()
                .map(|pay| format_date(pay.date.0, DateStyle::Notarial))
                .collect();
            let (last, prefix) = dates.split_last().expect("multiple interest dates");
            // The dates start with uppercase spelling, so Intl.ListFormat uses “y”.
            format!(
                "{} ({count}) CUOTAS DE {} CADA UNA. VENCIMIENTOS EL {} y {last}",
                count_words(count),
                payment_amount(amount, true),
                prefix.join(", ")
            )
        } else if interest.is_empty() {
            "Ninguna".into()
        } else {
            schedule_text(interest, words)
        };
        self.put("cuotas_intereses", schedule);
        self.put("cantidad_cuotas_intereses", count.to_string());
        self.put("cantidad_cuotas_intereses_letras", count_words(count));
        let style = if words {
            DateStyle::Notarial
        } else {
            DateStyle::Numeric
        };
        self.put(
            "cuotas_intereses_numeros",
            lines_or_na((1..=count).map(|n| n.to_string())),
        );
        self.put(
            "cuotas_intereses_fechas",
            lines_or_na(interest.iter().map(|pay| format_date(pay.date.0, style))),
        );
        self.put(
            "cuotas_intereses_montos",
            lines_or_na(
                interest
                    .iter()
                    .map(|pay| payment_amount(pay.amount_minor, words)),
            ),
        );
        if let Some(first) = interest.first() {
            self.put(
                "fecha_primera_cuota_intereses_letras",
                format_date(first.date.0, DateStyle::Notarial),
            );
        }
        if let Some(amount) = uniform {
            self.put("cuota_intereses_monto", money_number(amount));
            self.put("cuota_intereses_monto_letras", notarial_money_words(amount));
        }
        if valid_payment(capital) {
            self.put("cantidad_cuotas", (count + 1).to_string());
            self.put("cantidad_cuotas_letras", count_words(count + 1));
            self.put("numero_cuota_final_capital", (count + 1).to_string());
            if let Some(total) = interest.iter().try_fold(capital.amount_minor, |sum, pay| {
                sum.checked_add(pay.amount_minor)
                    .filter(|&total| is_safe(total))
            }) {
                self.put("total_financiamiento", money_number(total));
                self.put("total_financiamiento_letras", notarial_money_words(total));
            }
        }
    }

    fn uppercase(&mut self, keys: &[&str]) {
        for key in keys {
            if let Some(value) = self.values.get_mut(*key) {
                *value = value.to_uppercase();
            }
        }
    }

    fn add_vehicle(&mut self, kind: CaseDocumentType, vehicle: &Vehicle) {
        let plate = text(vehicle.plate.as_deref());
        let registration = text(vehicle.registration_number.as_deref());
        let description = expediente_vehicle_description(vehicle);
        let markers = [
            ("vehiculo_tipo", text(vehicle.vehicle_type.as_deref())),
            ("vehiculo_marca", text(vehicle.make.as_deref())),
            ("vehiculo_modelo", text(vehicle.model.as_deref())),
            ("vehiculo_anio", text(vehicle.year.as_deref())),
            ("vehiculo_color", text(vehicle.color.as_deref())),
            (
                "vehiculo_matricula",
                if registration.is_empty() {
                    plate.clone()
                } else {
                    registration
                },
            ),
            ("vehiculo_chasis", text(vehicle.chassis_number.as_deref())),
            ("vehiculo_placa", plate),
            ("vehiculo_motor", text(vehicle.engine_number.as_deref())),
            ("vehiculo_garantia", description.clone()),
            ("vehiculo_descripcion", description),
            ("vehiculo_ano", text(vehicle.year.as_deref())),
        ];
        let uppercase = matches!(
            kind,
            AutorizacionAsegurarVehiculo
                | AutorizacionData
                | Gps
                | EntregaVehiculo
                | EntregaVehiculoFinesSaldo
        ) || kind.disbursement()
            || kind.uppercase();
        for (key, value) in markers {
            self.put(
                key,
                if uppercase {
                    value.to_uppercase()
                } else {
                    value
                },
            );
        }
    }

    fn add_insurance_sale(&mut self, signature: Option<NaiveDate>, amount: Option<i64>) {
        for number in 1..=INSURANCE_SALE_COUNT {
            self.put(
                format!("fecha_de_vencimiento_de_la_cuota_{number}"),
                opt_date(signature.and_then(|date| add_months(date, number))),
            );
        }
        if let Some((amount, total)) = insurance_total(amount, INSURANCE_SALE_COUNT.into()) {
            self.put("monto_de_cada_cuota", money_number(amount));
            self.put("monto_total_financiado", money_number(total));
            self.put(
                "monto_total_financiado_en_letras",
                notarial_money_words(total),
            );
        }
    }

    fn add_insurance_payments(
        &mut self,
        kind: CaseDocumentType,
        operation: &Operation,
        signature: Option<NaiveDate>,
    ) {
        let count = operation
            .financing
            .as_ref()
            .and_then(|financing| financing.insurance_installment_count)
            .unwrap_or(10);
        if !(1..=MAX_SAFE).contains(&count) {
            return;
        }
        self.put("cantidad_cuotas_seguro", count.to_string());
        self.put("cantidad_cuotas_seguro_letras", count_words(count));
        let amount = operation.insurance_installment_minor;
        if kind == PagareSeguro {
            if let Some((amount, total)) = insurance_total(amount, count) {
                self.put("monto_cuota_seguro", money_number(amount));
                self.put("monto_cuota_seguro_letras", notarial_money_words(amount));
                self.put("monto_total_seguro", money_number(total));
                self.put("monto_total_seguro_letras", notarial_money_words(total));
                self.put(
                    "fecha_primera_cuota_seguro",
                    opt_date(signature.and_then(|date| add_months(date, 1))),
                );
                self.put(
                    "fecha_ultima_cuota_seguro",
                    opt_date(signature.and_then(|date| add_months(date, count.try_into().ok()?))),
                );
            }
        } else if kind == ActoSeguro {
            self.add_insurance_schedule(signature, count, amount);
        }
    }

    fn add_insurance_schedule(
        &mut self,
        signature: Option<NaiveDate>,
        count: i64,
        amount: Option<i64>,
    ) {
        let Some(amount) = amount.filter(|amount| (1..=MAX_SAFE).contains(amount)) else {
            self.issue("monto_de_cada_cuota", &field_message("monto_de_cada_cuota"));
            return;
        };
        let Some(date) = signature else { return };
        if u32::try_from(count)
            .ok()
            .and_then(|months| add_months(date, months))
            .is_none()
        {
            self.issue("fecha_firma", "El calendario de cuotas supera el año 9999.");
            return;
        }
        let Some((_, total)) = insurance_total(Some(amount), count) else {
            self.issue("monto_total_seguro", "La suma de las cuotas supera el monto que puede calcularse con precisión. Revisa los importes.");
            return;
        };
        let count = count as u32;
        self.put(
            "cuotas_seguro_numeros",
            lines_or_na((1..=count).map(|number| number.to_string())),
        );
        self.put(
            "cuotas_seguro_fechas",
            lines_or_na(
                (1..=count)
                    .map_while(|number| add_months(date, number))
                    .map(|date| format_date(date, DateStyle::Numeric)),
            ),
        );
        self.put(
            "cuotas_seguro_montos",
            vec![money_number(amount); count as usize].join("\n"),
        );
        self.put("monto_total_seguro", money_number(total));
        self.put("monto_total_seguro_letras", notarial_money_words(total));
    }

    fn add_issuer(
        &mut self,
        kind: CaseDocumentType,
        issuer: Option<&CompanyProfile>,
        issuer_literal: bool,
    ) {
        let name = issuer.map(legal_name).or(issuer_literal.then_some(INSURER));
        let Some(name) = name.filter(|name| is_issuer_name(name)) else {
            return;
        };
        let upper = name.trim().to_uppercase();
        if let Some(issuer) = issuer {
            for (key, value) in &issuer.values {
                let Some(suffix) = key.strip_prefix("empresa_").filter(|suffix| {
                    !suffix.is_empty()
                        && suffix.bytes().all(|byte| {
                            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                        })
                }) else {
                    continue;
                };
                let normalized =
                    if matches!(key.as_str(), "empresa_razon_social" | "empresa_nombre") {
                        value.trim().to_uppercase()
                    } else {
                        crate::modules::document_fill::format::document_clause_case(
                            key,
                            value.trim(),
                            false,
                        )
                    };
                self.put(format!("empresa_seguro_{suffix}"), normalized.clone());
                self.put(format!("emisor_seguro_{suffix}"), normalized.clone());
                if kind == VentaCondicionalSeguro {
                    self.put(key.clone(), normalized);
                }
            }
            self.put(
                "representante_seguro_nombre",
                company_profile_value(&issuer.values, "empresa_representante_nombre"),
            );
        }
        if kind == VentaCondicionalSeguro {
            for key in ["empresa_razon_social", "empresa_nombre"] {
                if self.get(key).is_empty() {
                    self.put(key, upper.clone());
                }
            }
        }
        for key in [
            "empresa_seguro_nombre",
            "emisor_seguro_nombre",
            "empresa_seguro_razon_social",
            "emisor_seguro_razon_social",
        ] {
            self.put(key, upper.clone());
        }
    }

    fn issue(&mut self, key: &'static str, message: &str) {
        self.issues.push((key, message.to_owned()));
    }

    pub(super) fn resolve(
        kind: CaseDocumentType,
        client: &Client,
        operation: &Operation,
        context: Context<'_>,
    ) -> Self {
        static TRANSIT: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"(?i)\by de tr[aá]nsito por\b").unwrap());
        let mut result = Self::default();
        let name = js_trim(&client.name);
        let address = text(client.address.as_deref()).to_uppercase();
        let transit = if address.is_empty() || TRANSIT.is_match(&address) {
            address.clone()
        } else {
            format!("{address} Y DE TRÁNSITO POR LA CAPITAL DE LA REPÚBLICA DOMINICANA")
        };
        let profile = client.profile.as_ref();
        let identity = client.identity.as_deref().map(js_trim);
        let mut identity_words = cedula_words(identity);
        let number = if identity_words.is_empty() {
            String::new()
        } else {
            identity_with_dashes(identity.unwrap_or_default())
        };
        if kind.notarial() {
            identity_words = identity_words.to_uppercase();
        }
        let signature = operation
            .signature_date
            .filter(|date| (1..=9999).contains(&date.year()));
        let signature_text = opt_date(signature);
        let operator = context.operator;
        let balance = operator.and_then(|operator| operator.balance_minor);
        for (key, value) in [
            ("cliente_nombre", name.to_owned()),
            ("cliente_nombre_firma", name.to_owned()),
            (
                "cliente_tratamiento",
                text(profile.and_then(|profile| profile.treatment.as_deref())),
            ),
            (
                "cliente_nacionalidad",
                text(profile.and_then(|profile| profile.nationality.as_deref())).to_lowercase(),
            ),
            (
                "cliente_ocupacion",
                text(profile.and_then(|profile| profile.position.as_deref())),
            ),
            (
                "cliente_estado_civil",
                text(profile.and_then(|profile| profile.marital_status.as_deref())).to_lowercase(),
            ),
            ("cliente_cedula", number.clone()),
            ("cliente_cedula_numeros", number),
            ("cliente_cedula_letras", identity_words),
            ("cliente_direccion", address),
            ("cliente_direccion_transito", transit),
            ("cliente_telefono", text(client.phone.as_deref())),
            ("cliente_correo", text(client.email.as_deref())),
            (
                "cliente_origen_ingresos",
                text(client.income_source.as_deref()),
            ),
            ("operacion_referencia", text(operation.reference.as_deref())),
            ("fecha_contrato", signature_text.clone()),
            ("fecha_firma", signature_text),
            (
                ANCHOR,
                opt_date(signature.and_then(|date| add_months(date, 1))),
            ),
            (
                "fecha_saldo",
                opt_date(operator.and_then(|operator| operator.balance_date)),
            ),
            (
                "saldo_confirmado",
                balance.map(money_number).unwrap_or_default(),
            ),
            (
                "saldo_confirmado_letras",
                balance.map(notarial_money_words).unwrap_or_default(),
            ),
            ("parrafo_compromiso_pago", text(context.sales_commitment)),
        ] {
            result.put(key, value);
        }
        result.add_vehicle(kind, context.vehicle);
        if matches!(kind, AutorizacionData | Gps) || kind.disbursement() {
            result.uppercase(&[
                "cliente_nombre",
                "cliente_nombre_firma",
                "cliente_direccion",
                "cliente_direccion_transito",
            ]);
        }
        if kind == DeclaracionJurada {
            result.put(
                "cliente_ocupacion",
                result.get("cliente_origen_ingresos").to_owned(),
            );
        }
        if kind.uppercase() {
            result.uppercase(&[
                "cliente_nombre",
                "cliente_nombre_firma",
                "cliente_tratamiento",
                "cliente_nacionalidad",
                "cliente_ocupacion",
                "cliente_estado_civil",
                "cliente_cedula_letras",
                "cliente_direccion",
                "cliente_direccion_transito",
                "cliente_origen_ingresos",
                "operacion_referencia",
            ]);
        }
        for &(key, base) in LEGACY_CASE_FIELDS {
            let base = if key == "placa_del_vehiculo" && result.get(base).is_empty() {
                "vehiculo_matricula"
            } else {
                base
            };
            result.put(key, result.get(base).to_owned());
        }
        if let Some(financing) = &operation.financing {
            result.add_financing(financing, kind.notarial_payment());
            if matches!(kind, VentaCondicional | PagareAutentico) {
                result.values.retain(|key, _| {
                    key != "abonos_extraordinarios"
                        && !key.starts_with("fecha_abono_extraordinario_")
                        && !key.starts_with("abono_extraordinario_")
                });
                if let Some(signature) = signature {
                    result.add_extra_payments(
                        &signature_extras(financing, signature),
                        kind == PagareAutentico,
                    );
                }
            }
        }
        if let Some(distribution) = operator.and_then(|operator| operator.distribution) {
            result.put("distribucion_desembolso", distribution);
        }
        if kind == VentaCondicionalSeguro {
            result.add_insurance_sale(signature, operation.insurance_installment_minor);
        }
        if kind.requires_issuer() {
            result.add_insurance_payments(kind, operation, signature);
            result.add_issuer(kind, context.issuer, context.issuer_literal);
        }
        let insurance_issues = std::mem::take(&mut result.issues);
        for &key in kind.required() {
            if matches!(
                key,
                "testigo_richard"
                    | "testigo_usuario"
                    | "fecha_contrato"
                    | "distribucion_desembolso"
            ) || (kind == VentaCondicionalSeguro && !matches!(key, "monto_de_cada_cuota"))
                || (kind == ActoSeguro
                    && matches!(
                        key,
                        "cuotas_seguro_numeros"
                            | "cuotas_seguro_fechas"
                            | "cuotas_seguro_montos"
                            | "monto_total_seguro"
                            | "monto_total_seguro_letras"
                    ))
                || (operation.vehicle.source_document == Some(VehicleDocument::BillOfLading)
                    && matches!(key, "vehiculo_matricula" | "placa_del_vehiculo"))
            {
                continue;
            }
            if result.get(key).is_empty() {
                result.issue(key, &field_message(key));
            }
        }
        if kind.requires_issuer() && result.get("empresa_seguro_nombre").is_empty() {
            result.issue(
                "empresa_seguro_nombre",
                &field_message("empresa_seguro_nombre"),
            );
        }
        result.issues.extend(insurance_issues);
        result
    }
}

#[derive(Default)]
pub(super) struct CaseValues {
    pub(super) values: Values,
    pub(super) issues: Vec<(&'static str, String)>,
}

pub(super) struct Context<'a> {
    pub(super) vehicle: &'a Vehicle,
    pub(super) operator: Option<&'a OperatorValues<'a>>,
    pub(super) sales_commitment: Option<&'a str>,
    pub(super) issuer: Option<&'a CompanyProfile>,
    pub(super) issuer_literal: bool,
}

fn lines_or_na(lines: impl Iterator<Item = String>) -> String {
    let lines = lines.collect::<Vec<_>>().join("\n");
    if lines.is_empty() {
        "No aplica".into()
    } else {
        lines
    }
}

fn insurance_total(amount: Option<i64>, count: i64) -> Option<(i64, i64)> {
    let amount = amount.filter(|amount| (1..=MAX_SAFE).contains(amount))?;
    let total = amount
        .checked_mul(count)
        .filter(|total| (1..=MAX_SAFE).contains(total))?;
    Some((amount, total))
}

fn legal_name(profile: &CompanyProfile) -> &str {
    profile
        .values
        .get("empresa_razon_social")
        .map(String::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or(&profile.name)
}

fn normalized_issuer(name: &str) -> String {
    normalized_words(name)
        .to_uppercase()
        .replace("S R L", "SRL")
}

pub(super) fn is_issuer_name(name: &str) -> bool {
    normalized_issuer(name) == normalized_issuer(INSURER)
}

pub(super) fn contains_issuer_name(paragraph: &str) -> bool {
    format!(" {} ", normalized_issuer(paragraph))
        .contains(&format!(" {} ", normalized_issuer(INSURER)))
}

fn field_message(key: &str) -> String {
    match key {
        "cliente_nombre" => "Completa el nombre en el expediente.",
        "cliente_cedula" | "cliente_cedula_letras" => "Registra una cédula de 11 dígitos en el expediente.",
        "cliente_direccion" | "cliente_direccion_transito" => "Completa la dirección en el expediente.",
        "cliente_telefono" => "Completa el teléfono en el expediente.",
        "cliente_correo" => "Completa el correo en el expediente.",
        "cliente_origen_ingresos" => "Completa el origen de los ingresos en el expediente.",
        "cliente_ocupacion" => "Completa la ocupación del cliente en el expediente.",
        "vehiculo_matricula" | "placa_del_vehiculo" => "Completa la placa en el expediente o, si el vehículo es importado, elige «Bill of lading (importado)» en Documento del vehículo.",
        "vehiculo_garantia" => "Completa los datos de la garantía vehicular en la operación.",
        "operacion_referencia" => "Completa la referencia en la operación.",
        "fecha_de_firma" | "fecha_firma" => "Guarda la fecha de firma en el detalle del expediente.",
        "fecha_saldo" => "Selecciona la fecha del saldo confirmado.",
        "saldo_confirmado" => "Indica el saldo confirmado en pesos con hasta dos decimales.",
        "cuotas_intereses" => "Revisa los importes y el orden de las cuotas de intereses en la operación.",
        "cuota_final_capital" => "Completa el importe y la fecha de la cuota final de capital en la operación.",
        "total_financiamiento" | "total_financiamiento_letras" => "Revisa los importes de las cuotas de intereses y el capital para calcular el total.",
        "monto_desembolso" => "Completa el importe de la cuota final de capital en la operación.",
        "cantidad_cuotas" | "cantidad_cuotas_letras" => "Completa el calendario de cuotas en la operación.",
        "parrafo_compromiso_pago" => "Vincula el Word de la venta que contiene la cláusula de compromiso de pago.",
        "cantidad_cuotas_seguro" => "Indica una cantidad entera de cuotas del seguro mayor que cero.",
        "empresa_seguro_nombre" => "Selecciona el perfil autorizado del emisor del seguro.",
        "monto_de_cada_cuota" => "Guarda el monto de cada cuota del seguro en el detalle del expediente.",
        _ => return format!("Falta o es inválido el campo «{}».", label(key)),
    }.to_owned()
}
