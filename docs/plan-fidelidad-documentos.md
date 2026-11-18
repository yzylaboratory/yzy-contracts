# Plan de fidelidad de los 15 documentos de YZY Contracts

El objetivo es que cada documento generado reproduzca su Word de referencia al rellenarlo con los mismos datos. Esto incluye el texto fijo, las mayúsculas de los valores, la tipografía por aparición, la estructura de las tablas, las firmas y la distribución por página. La generación individual y el lote deben usar la misma selección de plantilla y el mismo generador para cada documento. El lote determina qué documentos corresponden a la operación y solicita cada uno a ese generador.

## 1. Verificar una vez la plantilla de cada tipo documental por empresa

Los 15 archivos en `contracts-demo/preparadas/` coinciden por SHA-256 con los adjuntos. Son la referencia local de formato. El portal descarga el original asociado a la plantilla seleccionada para la empresa. La coincidencia de los archivos locales aún no acredita cuál está activa en producción.

- Inventariar los 15 tipos para la empresa destinataria. Registrar nombre del adjunto, tipo del catálogo, ID de plantilla efectiva, origen propio o compartido y SHA-256 del original descargado. Revisar selección automática, manual y recordada.
- Comprobar expresamente las tres entregas de vehículo y ambos pagarés. Asociar el adjunto de acto de seguro al tipo que usa sus marcadores. El catálogo también contiene una venta condicional de seguro con otros marcadores.
- Para cada diferencia de archivo, comparar contenido y estilo antes de decidir si requiere una actualización. Aplicar cualquier cambio de plantilla a la empresa y versión identificadas. Conservar el ID o la versión anterior para poder revertir la asignación.

**Salida:** una correspondencia comprobada para los 15 tipos y una lista de divergencias reales. Código de referencia en `apps/portal/app/clientes/operation-templates.ts` y `apps/portal/app/contratos/document-catalog.ts`.

## Resultado de la fase 1 en producción

Verificación del 17 de noviembre de 2026 para Inversiones Indriago Martínez SRL, empresa identificada en las referencias del financiamiento principal. Se cruzaron los Word convertidos propios y compartidos con el selector del portal y se calculó SHA-256 sobre los originales de producción. Trece tipos tienen exactamente una candidata, propia de la empresa. En esos tipos, una selección manual recordada solo es válida si apunta a esa misma candidata. Los otros dos tipos carecen de candidatas.

| Referencia y tipo del catálogo | ID de plantilla | SHA-256 de referencia / producción | Resultado |
|---|---|---|---|
| `acto_seguro.docx` | 38601373-63db-4c8d-8f86-b805b3afcbf9 | `9d6e37ead5dec80ac5bef8bdbc58f99489939e3b3841a5f59c0f9e767edd2f3b` / `918a4798fd4291fbd6a2278307e5eb44635000f543ad6b9496c8bdbaa1442b15` | Texto diferente. Marcadores de referencia ausentes en producción: `nombre_del_notario` |
| `acuerdo_seguro.docx` | a7f17d07-28b8-42e6-9e1b-9951cc281128 | `0d1c5ab734e7b46fec22ccedbd9c163a2b95daa25227adfe30f8e802ffc38388` / `e78606a759ffdc73e6664b7394a6e076ae5f4c03832e92d2d94c4ad99eebf63a` | Texto diferente. Marcadores de referencia ausentes en producción: `nombre_del_notario` |
| `autorizacion_asegurar_vehiculo.docx` | 5f8dbb20-153e-4639-834c-b507aea2ad9f | `e902ff1c1029af6bafe78adc1f42958d4711a86c35f00173e8b993a5240bc853` / `98b701837c1b0e1ddc68cde86f37c1523f91df8d65a213dfa67c87904677d903` | Solo cambian los metadatos core y app |
| `autorizacion_data.docx` | 15f26046-a299-4aeb-8698-48ac585e0d3e | `52c6341f6bf283e3182d3ca7580f6d45ffab9a6f5b085912acea712fbb5d5d43` / `8721b5c67e219a6c21efb5a9897a801eec6e304678497efe4aa88c40924a75d4` | Texto diferente. Marcadores de referencia ausentes en producción: `nombre_del_notario` |
| `autorizacion_desembolso.docx` | — | `cc90d54eda0b67491efabd8a49d6e9dc75f52d1ae8ed73f55ad78a3b7ae96b66` / — | Sin plantilla disponible |
| `declaracion_jurada.docx` | 628e95d0-dfb1-485d-bac3-ba4a46b1a73f | `efb37ff9aca08c47a53bfe00ebd37d1cd9a9c61296b690b9047ec26dea3a70d6` / `4e4d3286f57a666c0ad1edb26c811c3cd9056f41fc5b5a96be8dfda9595c2fe0` | Texto diferente. Marcadores de referencia ausentes en producción: `nombre_del_notario` |
| `designacion_cuenta.docx` | — | `b0a07294a9632071a863fad2dffa473cd2e6e2714a0618d74f2975f27ca4a6ce` / — | Sin plantilla disponible |
| `entrega_vehiculo.docx` | d279a08e-67f9-418e-8807-7f2f5305de32 | `01febfc4a5dccfeadf9751a3ff708d7219d08577ff4c9f4924fc93955ba40e80` / `01febfc4a5dccfeadf9751a3ff708d7219d08577ff4c9f4924fc93955ba40e80` | Idéntica byte por byte |
| `entrega_vehiculo_fines_saldo.docx` | 09c1f9e3-9837-4722-996f-b25c86534a83 | `9f4a012fbc402422516d9eaf8540efd0cacdd91e65aa2362a1e63f67d5b91bfb` / `487eb76e25dabe2979a5625493b2a35ba5b7a3852b575ffe05ee5ce38e60d86b` | Mismo contenido de todos los archivos internos del DOCX |
| `entrega_voluntaria.docx` | 8d3cc49e-9775-4aa7-a8d1-231e198a92f6 | `628853357c495f0f2608570f9b7d02091e72b75c9aa1ef589d373741a7c9515c` / `ba7762c2d585625f012b07a5b72473e6466e19232a7a6d3d59f1494591aa173a` | Texto diferente. Marcadores de referencia ausentes en producción: `nombre_del_notario` |
| `gps.docx` | 2e13f72d-f8c8-4a3f-896e-b1a61fd58e5e | `0f67d1d7620c04e33910734caba8891fe5fbddf3b1196d506523db7516c70c50` / `dcb2b7359fff96136d50130a2b4c4b2241a7eb23cfdfab6378d38e37c4029e2d` | Texto diferente. Marcadores de referencia ausentes en producción: `nombre_del_notario` |
| `levantamiento_oposicion.docx` | 9750641f-78b3-4cd7-95bb-e52b82e08d84 | `cd4d7854a471470cbebc40974e3d24a1996561d4ea1d8c547a3387272e5049d7` / `cd4d7854a471470cbebc40974e3d24a1996561d4ea1d8c547a3387272e5049d7` | Idéntica byte por byte |
| `pagare_autentico.docx` | 45300c93-55d9-4284-bc33-8cef73474989 | `bb67aaf1cc8467b5510c06ef86404e6c4f5a4cfd579bd9d6f412726992d99486` / `bb67aaf1cc8467b5510c06ef86404e6c4f5a4cfd579bd9d6f412726992d99486` | Idéntica byte por byte |
| `pagare_seguro.docx` | b06874a0-fdeb-47ba-a309-0127816c8dfa | `3f2058d4dac3a51cc9e946b99d0ba15114e81a852cf8ec0522c45649bcfc04e6` / `c75de0082345ea7a81824983a14ce1d8b43f94ea75c5d1eb58468e9650864998` | Texto diferente. Marcadores de referencia ausentes en producción: `nombre_del_notario` |
| `venta_condicional.docx` | 4b054474-961e-4026-a142-99269a392b57 | `9a14bb883784e1a66c404e7e405329894e352dd341f050d13abfaebdaa8e93b4` / `b91d300f337322dfd1ba3ef0310e12c2c36492cd200da52e042ec409d5bbcbb0` | Texto diferente. Marcadores de referencia ausentes en producción: `cliente_direccion`, `fecha_contrato`, `nombre_del_notario` |

La venta condicional con financiamiento de seguro compartida tiene un tipo propio. El selector la distingue del acto de seguro de este inventario. Las ocho plantillas con texto diferente requieren conciliación con la referencia antes de atribuir esas diferencias al generador. La comprobación cubre los originales almacenados y sus marcadores. La comparación de salidas Word y PDF corresponde a las fases posteriores.

## 2. Fijar las reglas y producir las referencias de comparación

Registrar cada aparición de los 66 marcadores distintos. Para cada una, anotar párrafo o celda, función dentro del documento, mayúsculas, fuente y tamaño, negrita, subrayado, alineación y ejemplo sintético esperado. Registrar también tamaño de papel, márgenes por lado, interlineado, sangrías, tabulaciones, anchos de tabla, saltos y posición de las firmas. El mismo marcador puede tener reglas distintas en la identificación, en una cláusula y al firmar.

Tomar el formato del DOCX adjunto y contrastar la escritura de los valores con los originales rellenados disponibles en `contracts-demo/`. Hay varios ejemplos en los que el nombre figura íntegramente en mayúsculas. Comprobar por separado dirección, tratamiento, nacionalidad, estado civil, ocupación, correo, cédula en letras, importes y fechas. Registrar como pendiente una capitalización que carezca de evidencia. Mantener los expedientes reales fuera de fixtures y del control de versiones.

Preparar un expediente sintético con acentos, entrada en caja mixta, dirección larga, cédula con cero inicial, varias cuotas y cuota final. Rellenar una copia de cada referencia con esos datos por una vía independiente del generador que se va a probar. Conservar el Word esperado y su exportación visual de referencia, con la versión de Word y las fuentes utilizadas. Guardar en el repositorio únicamente material de prueba sintético.

| Plantilla | Detalle que debe quedar cubierto en la comparación |
|---|---|
| Venta condicional | Lista antes del título, cabecera azul, cuotas centradas en letra normal, fila de capital final, vehículo en negrita y abonos extraordinarios en letra normal. |
| Acto de seguro | Título antes de la lista, fechas de cuotas en Calibri 11 a la izquierda, vehículo en Times New Roman 12 negrita, cuerpo en Arial 10. |
| Acuerdo de seguro | Fechas en negrita en ambas apariciones. Nombre del notario subrayado en la firma. |
| Autorización para asegurar vehículo | Fecha arriba a la derecha en negrita. Asunto a la izquierda y nombre del cliente centrado en la firma. |
| Autorización de datos | Línea fija del GPS en mayúsculas y negrita. Las dos apariciones del marcador de fecha tienen formato normal en el adjunto. |
| Autorización de desembolso | Papel A4, fecha superior normal, monto y distribución en negrita, nombre de firma centrado y subrayado. |
| Declaración jurada | Courier New 12. Teléfono en negrita, correo y origen de ingresos en letra normal. |
| Designación de cuenta | Título Arial 12, cuerpo Arial 11. Nombre, nacionalidad y ocupación en negrita en la identificación. El nombre pasa a letra normal en la cláusula primera. |
| Entrega de vehículo | Arial 12, firmas centradas una debajo de la otra con nombres subrayados. Ambas fechas en letra normal. |
| Entrega de vehículo para saldo | Arial 11, firmas lado a lado y rótulos subrayados. Fecha en negrita en el cierre y normal en la certificación. |
| Entrega voluntaria | Courier New 12, título subrayado, tratamiento normal, cédula en letras y números en negrita y testigos en tabla de dos columnas. |
| GPS | Arial 11, encabezados numerados en mayúsculas y negrita, fechas normales y firma del notario subrayada. |
| Levantamiento de oposición | Courier New 12, márgenes de media pulgada, bloque notarial gris oscuro y firmas separadas verticalmente. |
| Pagaré auténtico | Fecha y tratamiento normales en la plantilla. Capital, cuotas y vencimientos en negrita. Párrafo de compromiso normal. Testigos lado a lado y rótulo fijo de página. |
| Pagaré de seguro | Fecha de firma normal en la plantilla. Cantidad, monto de las cuotas y ambos vencimientos en negrita. Testigos fijos y rótulo de página. |

### Resultado de la fase 2

La [matriz por aparición](matriz-fidelidad-documentos.md) reúne 260 posiciones de 66 campos en los 15 documentos. Para el uso de mayúsculas se registraron 233 observaciones directas, una parcial, 18 inferencias y ocho posiciones pendientes. La carpeta local `contracts-demo/referencias-fase-2/` contiene los Word rellenados, los PDF de control, la matriz en CSV y las propiedades de maquetación del original. El ZIP reúne los entregables. Las variables del expediente son sintéticas.

Los 15 PDF se exportaron con LibreOffice 25.2.3.2 y las fuentes de los modelos. Se revisaron sus 28 páginas. La exportación automatizada en Microsoft Word agotó el tiempo de espera. La comparación de paginación con Word queda pendiente.

## 3. Medir y corregir las diferencias de Word

Generar los 15 Word actuales con el expediente sintético antes de tocar el código. Clasificar cada diferencia por causa para corregirla en su origen.

- **Valor escrito.** Revisar `expediente-fields.ts`, que ya transforma nacionalidad, estado civil, direcciones y ciertos nombres según el tipo documental. Comprobar también acentos, ceros de cédula, moneda, fechas y números en letras. Limitar los ajustes al campo y tipo afectados.
- **Formato de la aparición.** Revisar `native-document.ts`, que rellena el original y también impone negrita a direcciones y a partes de algunas fechas. Conservar el estilo del tramo de texto de Word donde cae el marcador, incluso si Word dividió el marcador entre varios tramos. Aplicar excepciones de formato solo donde las sustenten las referencias. Probar dos apariciones del mismo nombre o fecha con estilos diferentes.
- **Estructura.** Revisar cómo se expanden las filas de cuotas y cómo se inserta texto de varias líneas. Conservar sombreado, anchos, alineaciones, tabuladores, marcas de párrafo y firmas. Incluir una cuota, varias cuotas y un valor largo.

**Criterio de paso:** los 15 Word abren correctamente, contienen los valores sintéticos esperados y conservan el formato de cada aparición. Comprobar texto fijo, estilos efectivos y estructura del DOCX. Revisar visualmente todos los documentos con el mismo juego de datos que su referencia. Un marcador obligatorio visible o una firma desplazada respecto a la referencia queda registrado como fallo.

### Resultado de la comparación de Word

Con el mismo expediente sintético en ambos lados, los 15 Word descargados en Chrome coincidieron con sus referencias en las 260 apariciones de campos y en la estructura del documento. Las 28 páginas coincidieron píxel por píxel al renderizar ambos conjuntos con LibreOffice a 108 ppp. Los importes y fechas esperados se calcularon para la operación usada en la prueba. La matriz identifica las convenciones inferidas donde el original tenía un campo vacío.

El lote produjo 14 documentos con seguro financiado y 10 con seguro pagado. Cada archivo coincidió internamente con su descarga individual. Las dos cartas de desembolso recibieron la misma distribución. La entrega del vehículo para fines de saldo se verificó mediante descarga individual. Los documentos de muestra están en `contracts-demo/validacion-fase-3/word-descargados.zip`.

## 4. Comprobar el PDF de cada plantilla

Generar los 15 PDF por el flujo que envía el Word preparado al servicio de conversión con LibreOffice. Comparar con el PDF de referencia de la fase 2 usando los mismos datos. Verificar fuentes efectivas, dimensiones y cantidad de páginas, saltos de línea, celdas, subrayados y firmas. Superponer las páginas renderizadas a igual resolución para localizar diferencias.

En venta condicional, aislar el efecto del ajuste de anchos y posición que ya se aplica para PDF. En los documentos con Calibri, Arial, Times New Roman y Courier New, comprobar sustituciones y métricas en el contenedor de producción. Resolver desviaciones de maquetación en la plantilla, en el ajuste específico de PDF o en las fuentes del conversor según dónde se originen.

**Criterio de paso:** con el caso de referencia coinciden el papel, la distribución del contenido por página, las tablas y las firmas. En el caso de texto largo, verificar que el contenido fluya completo y que las filas, rótulos y firmas sigan siendo legibles. Distinguir las diferencias de suavizado de los cambios visibles en tipografía o posición.

## 5. Validar el generador compartido y publicar

Ampliar las pruebas existentes en `apps/portal/tests/expediente.test.mjs` con los casos de fidelidad de las fases 3 y 4. Verificar que ambas formas de generación deleguen la selección y el rellenado en la misma lógica, con la empresa, los datos y el formato solicitados. Para el lote inicial, comprobar qué tipos documentales solicita cuando el seguro está pagado y cuando está financiado.

Registrar un único resultado de fidelidad por documento y formato. El criterio de aceptación son **15 Word y 15 PDF** comparados con sus referencias. Desplegar únicamente los servicios afectados por el flujo de producción del repositorio. Verificar la versión activa y repetir una descarga representativa de los formatos y familias que hayan cambiado en un expediente sintético autorizado. Conservar la correspondencia de plantillas y la versión previa para revertir cualquier desviación.
