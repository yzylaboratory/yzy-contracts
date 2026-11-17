# Plantillas Word para expedientes

Desde **Clientes**, abre el expediente y elige una operación. En **Tipo de documento**, selecciona el documento y su plantilla. Para agregar una plantilla, carga un `.docx` en **Contratos** y asígnalo a la empresa de la operación. El portal también admite plantillas compartidas que incluyan esa empresa.

[Descargar carta de saldo de demostración](public/plantillas-demo/carta-saldo.docx) · [Descargar entrega de documentos de demostración](public/plantillas-demo/entrega-documentos.docx)

Para probar los Word de demostración, cárgalos con los nombres **Carta de saldo** y **Entrega de documentos**. Usa un expediente sintético con nombre, cédula, referencia, fecha de contrato y datos del vehículo. Completa la fecha de firma, los documentos entregados o el saldo y su fecha según corresponda. El saldo puede ser cero y se confirma por documento.

## Marcadores requeridos

Inserta los marcadores en texto normal de Word o dentro de celdas. Escribe cada clave entre dos llaves dobles, como `{{cliente_nombre}}`. Un marcador puede repetirse. Coloca el nombre del cliente también en los renglones de firma que le correspondan. Los marcadores adicionales se muestran en el formulario si requieren un valor manual.

| Tipo | Marcadores |
| --- | --- |
| Venta condicional | `cliente_nombre`, `cliente_cedula`, `cliente_direccion_transito`, `vehiculo_matricula`, `fecha_contrato`, `fecha_firma` (`fecha_firma` al estilo del acto notarial), `cuotas_intereses`, `cuota_final_capital`, `total_financiamiento` |
| Pagaré auténtico | `cliente_nombre`, `cliente_cedula`, `cliente_cedula_letras`, `cliente_direccion`, `vehiculo_garantia`, `fecha_firma`, `parrafo_compromiso_pago`, `cantidad_cuotas`, `cantidad_cuotas_letras`, `cuotas_intereses`, `cuota_final_capital`, `total_financiamiento`, `total_financiamiento_letras`, `testigo_richard`, `testigo_usuario` |
| Entrega voluntaria | `cliente_nombre`, `cliente_cedula`, `cliente_cedula_letras`, `vehiculo_garantia`, `fecha_firma` |
| Acto de seguro | `cliente_nombre`, `vehiculo_garantia`, `cantidad_cuotas_seguro`, `fecha_firma`, `cuotas_seguro_numeros`, `cuotas_seguro_fechas`, `cuotas_seguro_montos`, `monto_total_seguro`, `monto_total_seguro_letras` |
| Pagaré de seguro | `cliente_nombre`, `vehiculo_garantia`, `cantidad_cuotas_seguro`, `fecha_firma` |
| Declaración jurada | `cliente_nombre`, `cliente_cedula`, `cliente_telefono`, `cliente_correo`, `cliente_origen_ingresos`, `fecha_contrato`, `vehiculo_garantia`, `fecha_firma` |
| GPS y autorización de datos | `cliente_nombre`, `cliente_direccion`, `vehiculo_garantia`, `fecha_firma` (nombre, domicilio y vehículo en mayúsculas; `fecha_firma` al estilo del acto notarial) |
| Acuerdo de seguro | `cliente_nombre`, `cliente_cedula`, `fecha_firma` |
| Autorización para asegurar vehículo | `cliente_nombre`, `cliente_cedula`, `cliente_direccion`, `vehiculo_garantia`, `fecha_firma` |
| Autorización de desembolso | `cliente_nombre`, `cliente_cedula`, `cliente_direccion`, `vehiculo_garantia`, `fecha_firma`, `monto_desembolso`, `distribucion_desembolso` (nombre, domicilio y vehículo en mayúsculas; `fecha_firma` como 30/09/2026; `monto_desembolso` es la cuota final de capital en letras y números; `distribucion_desembolso` se escribe al generar) |
| Levantamiento de oposición | `cliente_nombre`, `cliente_cedula`, `cliente_direccion`, `vehiculo_garantia` |
| Entrega de vehículo y entrega de vehículo con fines de saldo | `cliente_nombre`, `cliente_cedula`, `vehiculo_garantia`, `fecha_firma` |
| Entrega de documentos | `cliente_nombre`, `cliente_cedula`, `vehiculo_garantia`, `operacion_referencia`, `fecha_contrato`, `fecha_firma` |
| Carta de saldo | `cliente_nombre`, `cliente_cedula`, `vehiculo_garantia`, `operacion_referencia`, `fecha_contrato`, `fecha_firma`, `saldo_confirmado`, `fecha_saldo` |

`cliente_cedula_numeros` equivale a `cliente_cedula`. `vehiculo_descripcion` equivale a `vehiculo_garantia`, que reúne los datos registrados. Puedes agregar campos específicos como `vehiculo_marca`, `vehiculo_modelo`, `vehiculo_anio`, `vehiculo_color`, `vehiculo_chasis`, `vehiculo_placa`, `vehiculo_motor` y `vehiculo_tipo`. En los contratos, las direcciones se imprimen en mayúsculas y `cliente_direccion_transito` incluye el literal «Y DE TRÁNSITO POR LA CAPITAL DE LA REPÚBLICA DOMINICANA».

## Plan de cuotas y compromiso de pago

Las primeras cuotas se leen como intereses y la última como capital. El total suma esos importes. El bloque de abonos usa sus importes registrados y las fechas de cuatro en cuatro meses desde el primer abono. Puedes usar `cuotas_intereses_numeros`, `cuotas_intereses_fechas` y `cuotas_intereses_montos` en tres celdas de una misma fila, con una línea por cuota. Para el capital, usa `numero_cuota_final_capital`, `fecha_cuota_final_capital` y `cuota_final_capital_monto` como conjunto. Los importes de cuotas del pagaré se presentan en números y letras. Para el interés uniforme están disponibles `cuota_intereses_monto` y `cuota_intereses_monto_letras`. `cantidad_cuotas_intereses` y `cantidad_cuotas_intereses_letras` excluyen la cuota de capital.

Si el Word de venta incluye `fecha_ancla_cuota_extraordinaria`, ingresa la fecha de inicio de la cuota porcentual al generar. El pagaré también pide esa fecha cuando la plantilla de venta vinculada incluye el marcador. Los abonos registrados conservan sus propias fechas e importes.

Al generar el pagaré, selecciona el Word de venta condicional de la empresa del expediente. Mantén el texto de compromiso en un solo párrafo del cuerpo del Word, desde la primera aparición de «se compromete» hasta la última aparición de «pactadas». Usa marcadores del expediente en los datos que deban variar dentro de ese tramo. Confirma el primer testigo y revisa el nombre del usuario que aparecerá como segundo testigo.

## Emisor del seguro

Los documentos de seguro pueden incluir la razón social autorizada en el Word o usar los marcadores dedicados `empresa_seguro_nombre` y `emisor_seguro_nombre`. Para otros datos de un perfil autorizado, puedes usar claves como `empresa_seguro_rnc` o `emisor_seguro_direccion`. Para **Acto de seguro** y **Venta condicional de seguro**, el monto de cada cuota del seguro se registra en el expediente.

Para el **Acto de seguro**, coloca `cuotas_seguro_numeros`, `cuotas_seguro_fechas` y `cuotas_seguro_montos` en tres celdas de la misma fila. El portal toma automáticamente las cuotas mensuales registradas en el expediente (10 por defecto) a partir de la fecha de firma y del monto de cada cuota, agrega una línea por cuota en cada columna y completa el total en números y letras. **Pagaré de seguro** también toma directamente la cantidad de cuotas registrada en el expediente (10 por defecto).
