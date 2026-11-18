import { formatPagareAutentico, pagareAutenticoBoldFields } from "./word-pagare-autentico";
import { formatEntregaVoluntaria } from "./word-entrega-voluntaria";
import { ventaCondicionalSeguroBoldFields } from "./word-venta-condicional-seguro";
import { entregaVehiculoBoldFields, formatEntregaVehiculo } from "./word-entrega-vehiculo";
import { pagareSeguroBoldFields } from "./word-pagare-seguro";
import { formatActoSeguro, actoSeguroBoldFields } from "./word-acto-seguro";
import { formatGps, gpsBoldFields } from "./word-gps";
import { formatAutorizacionData, autorizacionDataBoldFields } from "./word-autorizacion-data";
import { formatVentaCondicional, ventaCondicionalBoldFields } from "./word-venta-condicional";
import { formatDeclaracionJurada, declaracionJuradaBoldFields } from "./word-declaracion-jurada";

export const reviewedWordLayout: Readonly<Record<string, { boldFields: readonly string[]; format?: (doc: Document) => void } | undefined>> = {
  pagare_autentico: { boldFields: pagareAutenticoBoldFields, format: formatPagareAutentico },
  entrega_voluntaria: { boldFields: [], format: formatEntregaVoluntaria },
  venta_condicional_seguro: { boldFields: ventaCondicionalSeguroBoldFields },
  entrega_vehiculo: { boldFields: entregaVehiculoBoldFields, format: formatEntregaVehiculo },
  pagare_seguro: { boldFields: pagareSeguroBoldFields },
  acto_seguro: { boldFields: actoSeguroBoldFields, format: formatActoSeguro },
  gps: { boldFields: gpsBoldFields, format: formatGps },
  autorizacion_data: { boldFields: autorizacionDataBoldFields, format: formatAutorizacionData },
  venta_condicional: { boldFields: ventaCondicionalBoldFields, format: formatVentaCondicional },
  declaracion_jurada: { boldFields: declaracionJuradaBoldFields, format: formatDeclaracionJurada },
};
