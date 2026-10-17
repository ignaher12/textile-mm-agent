// Prints the live reference price for every pair, with the sources behind it.
import { createPairFeed, PAIRS } from "../src/feeds/pairs.js";

for (const pair of PAIRS) {
  const ref = await createPairFeed(pair).get();
  console.log(`\n${pair}`);
  for (const q of ref.used) {
    const age = Math.round((Date.now() - q.timestamp) / 1000);
    console.log(`  ✓ ${q.source.padEnd(26)} ${q.price.toFixed(4).padStart(12)}  (${age}s old)`);
  }
  for (const r of ref.rejected) console.log(`  ✗ ${r.source.padEnd(26)} ${r.reason}`);
  console.log(ref.ok ? `  → reference: ${ref.price.toFixed(4)}` : `  → NO PRICE: ${ref.reason}`);
}
