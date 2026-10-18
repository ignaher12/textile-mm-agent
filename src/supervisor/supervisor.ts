import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { QuoteParams } from "../engine/params.js";
import type { SupervisorContext } from "./context.js";
import { applyDecision, parseDecision, type Decision } from "./decision.js";
import type { ChatFn, ChatMessage } from "./llm.js";
import { buildMessages } from "./prompt.js";

export interface DecisionRecord {
  time: string;
  ok: boolean;
  decision: Decision | null;
  error: string | null;
  before: QuoteParams;
  after: QuoteParams;
  context: SupervisorContext;
}

/**
 * The LLM supervisor. One `run()` asks the model for a decision on the given
 * context, validates it (one retry with the validation error), clamps it into
 * the hard bounds and applies it. Any failure keeps the previous params: the
 * supervisor is never on the critical path.
 */
export function createSupervisor(opts: {
  chat: ChatFn;
  getParams: () => QuoteParams;
  setParams: (p: QuoteParams) => void;
  record: (r: DecisionRecord) => void;
}) {
  return {
    async run(context: SupervisorContext): Promise<DecisionRecord> {
      const before = opts.getParams();
      const messages = buildMessages(context);
      let decision: Decision | null = null;
      let error: string | null = null;

      for (let attempt = 0; attempt < 2 && !decision; attempt++) {
        try {
          const reply = await opts.chat(messages);
          try {
            decision = parseDecision(reply);
          } catch (err) {
            error = `invalid decision: ${message(err)}`;
            messages.push(
              { role: "assistant", content: reply } satisfies ChatMessage,
              { role: "user", content: `That reply was rejected (${error}). Reply with only the JSON object.` },
            );
          }
        } catch (err) {
          error = `LLM call failed: ${message(err)}`;
          break; // Network or API errors aren't fixed by asking again right away.
        }
      }

      const after = decision ? applyDecision(before, decision) : before;
      if (decision) opts.setParams(after);
      const record: DecisionRecord = {
        time: new Date().toISOString(),
        ok: decision !== null,
        decision,
        error: decision ? null : error,
        before,
        after,
        context,
      };
      opts.record(record);
      return record;
    },
  };
}

/** Appends decision records as JSON lines: the audit trail of every supervisor call. */
export function jsonlRecorder(path: string) {
  return (r: DecisionRecord) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(r) + "\n");
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
