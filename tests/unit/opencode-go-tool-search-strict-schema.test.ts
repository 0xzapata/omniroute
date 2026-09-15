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
import {
  strictCompleteToolSearchSchemas,
  inlineRecursiveSchemaRefs,
  inlineRecursiveSchemaRefsForTools,
} from "../../open-sse/translator/helpers/schemaCoercion.ts";

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

// Second OpenCode Go rejection on the same incident: "Recursive JSON schemas are not
// currently supported" — Codex desktop's gmail `_create_draft` MCP tool references
// `#/$defs/GmailMessagePartRequest` from inside that definition. Verified live: the
// verbatim schema 400s, the inlined+cycle-cut schema is accepted.
const RECURSIVE = {
  type: "object",
  properties: {
    body: { $ref: "#/$defs/Part", description: "top" },
    subject: { type: "string" },
  },
  required: ["body"],
  $defs: {
    Part: {
      type: "object",
      properties: {
        text: { type: "string" },
        parts: { type: "array", items: { $ref: "#/$defs/Part" } },
      },
    },
  },
};

test("inlineRecursiveSchemaRefs inlines local $refs and cuts the cycle", () => {
  const out = inlineRecursiveSchemaRefs(RECURSIVE) as Record<string, any>;
  const text = JSON.stringify(out);
  assert.ok(!text.includes("$ref"), "no $ref may remain");
  assert.ok(!text.includes("$defs"), "no $defs may remain");
  assert.equal(out.properties.body.type, "object");
  assert.equal(out.properties.body.description, "top", "sibling keys on the $ref node win");
  assert.equal(out.properties.body.properties.text.type, "string");
  const nested = out.properties.body.properties.parts.items;
  assert.equal(nested.type, "object");
  assert.match(nested.description, /recursion elided/);
  assert.equal(out.properties.subject.type, "string");
  assert.deepEqual(out.required, ["body"]);
});

test("inlineRecursiveSchemaRefs is a no-op without $ref", () => {
  const plain = { type: "object", properties: { a: { type: "string" } } };
  assert.equal(inlineRecursiveSchemaRefs(plain), plain);
});

test("inlineRecursiveSchemaRefsForTools reaches namespace children", () => {
  const tools = [{ type: "namespace", name: "mcp__gmail", tools: [{ type: "function", name: "_create_draft", parameters: RECURSIVE }] }];
  const [ns] = inlineRecursiveSchemaRefsForTools(tools) as Array<Record<string, any>>;
  assert.ok(!JSON.stringify(ns.tools[0].parameters).includes("$ref"));
});

test("opencode-go Responses target inlines recursive MCP schemas; openai keeps $ref", () => {
  const body = {
    model: "muse-spark-1.3-contributor",
    stream: true,
    input: "hi",
    tools: [{ type: "namespace", name: "mcp__gmail", tools: [{ type: "function", name: "_create_draft", parameters: RECURSIVE }] }],
  };
  const go = translateRequest("openai-responses", "openai-responses", body.model, body, true, null, "opencode-go") as Record<string, any>;
  assert.ok(!JSON.stringify(go.tools).includes("$ref"));
  const oa = translateRequest("openai-responses", "openai-responses", body.model, body, true, null, "openai") as Record<string, any>;
  assert.ok(JSON.stringify(oa.tools).includes("$ref"));
});
