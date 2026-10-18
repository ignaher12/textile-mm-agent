// Runs the LLM supervisor once on live wARS data and prints its decision.
// Nothing is applied or recorded: use it to check the API key, the model and
// the prompt. Without LLM_API_KEY it prints the context only.
//
//   npm run supervise
import { privateKeyToAccount } from "viem/accounts";
import { createCeloClient } from "../src/chain/celo.js";
import { readInventory } from "../src/chain/inventory.js";
import { loadEnv, required } from "../src/config/env.js";
import { DEFAULT_PARAMS, type QuoteParams } from "../src/engine/params.js";
import { createPairFeed } from "../src/feeds/pairs.js";
import { createRiskManager } from "../src/risk/riskManager.js";
import { createPriceHistory } from "../src/supervisor/context.js";
import { createChat } from "../src/supervisor/llm.js";
import { buildLiveContext } from "../src/supervisor/live.js";
import { createParamsStore } from "../src/supervisor/paramsStore.js";
import { createSupervisor } from "../src/supervisor/supervisor.js";

async function main() {
  const env = loadEnv();
  const me = privateKeyToAccount(required(env, "PRIVATE_KEY")).address;
  const client = createCeloClient(env.CELO_RPC_URL);

  const ref = await createPairFeed("USDT/ARS").get();
  if (!ref.ok) throw new Error(`no reference price: ${ref.reason}`);
  const inventory = await readInventory(client, me, "USDT/ARS");
  const params = createParamsStore("data/params-wars-usdt.json").load() ?? DEFAULT_PARAMS;
  const risk = createRiskManager().evaluate({ now: Date.now(), ref: ref.price, nav: inventory.base + inventory.quote / ref.price });
  const history = createPriceHistory();
  history.add(Date.now(), ref.price);

  const context = await buildLiveContext({
    me, client, refPrice: ref.price, history, inventory, risk, params, stitchSpreadBpsPerSide: 20, recentDecisions: [],
  });
  console.log("Context sent to the supervisor:\n" + JSON.stringify(context, null, 2));

  if (!env.LLM_API_KEY) return console.log("\nLLM_API_KEY is not set in .env: nothing sent.");

  let proposed: QuoteParams = params;
  const supervisor = createSupervisor({
    chat: createChat({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL }),
    getParams: () => params,
    setParams: (p) => (proposed = p),
    record: () => {},
  });
  console.log(`\nAsking ${env.LLM_MODEL}…`);
  const r = await supervisor.run(context);
  if (!r.decision) return console.log(`✗ ${r.error}`);
  console.log(`\nDecision (not applied):\n${JSON.stringify(r.decision, null, 2)}`);
  console.log(`\nParams after clamping: ${JSON.stringify(proposed)}`);
}

await main();
