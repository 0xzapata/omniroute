/**
 * Heimdall incident 2026-09-15: OpenCode Go validates the Codex `tool_search` built-in's
 * schema in strict mode on muse-spark ("'required' is required to be supplied and to be an
 * array including every key in properties. Missing 'limit'"), while DeepSeek on the same
 * gateway accepts it verbatim. Codex declares `limit` optional. For opencode-go Responses
 * targets the schema is strict-completed: every property required, optional ones widened
 * to accept null, additionalProperties false; type/execution untouched so Codex still gets
 * a client-resolved `tool_search_call`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { translateRequest } from "../../open-sse/translator/index.ts";
import { strictCompleteToolSearchSchemas } from "../../open-sse/translator/helpers/schemaCoercion.ts";

const TOOL_SEARCH = {
  type: "tool_search",
  execution: "client",
  description: "Search deferred tools.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Maximum number of tools to return. Defaults to 8." },
      query: { type: "string", description: "Search query for deferred tools." },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

test("strictCompleteToolSearchSchemas requires every property and widens optional ones to null", () => {
  const [out] = strictCompleteToolSearchSchemas([TOOL_SEARCH]) as Array<Record<string, any>>;
  assert.equal(out.type, "tool_search");
  assert.equal(out.execution, "client");
  assert.deepEqual(out.parameters.required, ["limit", "query"]);
  assert.deepEqual(out.parameters.properties.limit.type, ["number", "null"]);
  assert.equal(out.parameters.properties.query.type, "string");
  assert.equal(out.parameters.additionalProperties, false);
});

test("strictCompleteToolSearchSchemas leaves function tools alone", () => {
  const fn = { type: "function", name: "f", parameters: { type: "object", properties: { a: { type: "string" } } } };
  assert.deepEqual(strictCompleteToolSearchSchemas([fn]), [fn]);
});

function translate(provider: string) {
  const body = { model: "muse-spark-1.3-contributor", stream: true, input: "hi", tools: [TOOL_SEARCH] };
  return translateRequest("openai-responses", "openai-responses", body.model, body, true, null, provider) as Record<string, any>;
}

test("opencode-go Responses target strict-completes tool_search", () => {
  const out = translate("opencode-go");
  assert.deepEqual(out.tools[0].parameters.required, ["limit", "query"]);
});

test("other Responses providers keep the client's tool_search schema", () => {
  const out = translate("openai");
  assert.deepEqual(out.tools[0].parameters.required, ["query"]);
});
