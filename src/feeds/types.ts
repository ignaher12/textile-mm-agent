/**
 * A price observation, expressed as units of the quote currency per 1 USD₮
 * (e.g. ARS per USD₮). Timestamps are Unix milliseconds.
 */
export interface PriceQuote {
  source: string;
  price: number;
  timestamp: number;
}

export type FetchFn = typeof fetch;

export interface PriceSource {
  readonly name: string;
  fetch(signal: AbortSignal): Promise<PriceQuote>;
}
