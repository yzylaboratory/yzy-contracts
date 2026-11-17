import { formatActoSeguro, actoSeguroBoldFields } from "./word-acto-seguro";
import { formatGps, gpsBoldFields } from "./word-gps";
import { formatAutorizacionData, autorizacionDataBoldFields } from "./word-autorizacion-data";
import { formatVentaCondicional, ventaCondicionalBoldFields } from "./word-venta-condicional";
import { formatDeclaracionJurada, declaracionJuradaBoldFields } from "./word-declaracion-jurada";

export const reviewedWordLayout: Readonly<Record<string, { boldFields: readonly string[]; format: (doc: Document) => void } | undefined>> = {
  acto_seguro: { boldFields: actoSeguroBoldFields, format: formatActoSeguro },
  gps: { boldFields: gpsBoldFields, format: formatGps },
  autorizacion_data: { boldFields: autorizacionDataBoldFields, format: formatAutorizacionData },
  venta_condicional: { boldFields: ventaCondicionalBoldFields, format: formatVentaCondicional },
  declaracion_jurada: { boldFields: declaracionJuradaBoldFields, format: formatDeclaracionJurada },
};
