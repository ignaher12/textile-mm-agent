import { z } from "zod";
import { fetchJson } from "../http.js";
import type { FetchFn, PriceSource } from "../types.js";

const responseSchema = z.object({
  compra: z.number().positive(),
  venta: z.number().positive(),
  fechaActualizacion: z.iso.datetime(),
});

/** DolarAPI "dólar cripto" (ARS per USD₮), mid of buy and sell. */
export function dolarApiSource(opts: { fetchFn?: FetchFn } = {}): PriceSource {
  const { fetchFn = fetch } = opts;
  const name = "dolarapi:cripto";
  const url = "https://dolarapi.com/v1/dolares/cripto";

  return {
    name,
    async fetch(signal) {
      const data = await fetchJson(fetchFn, url, responseSchema, signal);
      return {
        source: name,
        price: (data.compra + data.venta) / 2,
        timestamp: Date.parse(data.fechaActualizacion),
      };
    },
  };
}
