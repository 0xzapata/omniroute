/**
 * A streaming Responses request whose built-in `web_search` tool was
 * converted to the `omniroute_web_search` fallback is executed non-streaming
 * (streaming interception is not implemented — #9725). The assembled result used
 * to be returned as `application/json`, which strict Responses-SSE clients (Codex)
 * reject with "stream closed before response.completed". These tests pin the SSE
 * re-wrap that keeps the response.created … response.completed contract.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  synthesizeResponsesSseFromJson,
  buildResponsesSseResponse,
} from "../../open-sse/handlers/chatCore/nonStreamingResponsesSse.ts";

function completedResponse() {
  return {
    id: "resp_test_123",
    object: "response",
    created_at: 1789134788,
    status: "completed",
    model: "deepseek-v4.1-flash",
    output: [
      {
        id: "rs_resp_test_123_0",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "thinking" }],
      },
      {
        id: "msg_resp_test_123_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "PONG", annotations: [] }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  };
}

function parseEvents(body: string) {
  return body
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const type = lines.find((l) => l.startsWith("event: "))?.slice("event: ".length);
      const dataLine = lines.find((l) => l.startsWith("data: "));
      return { type, data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) : null };
    });
}

test("synthesized SSE carries response.created and a terminal response.completed", () => {
  const events = parseEvents(synthesizeResponsesSseFromJson(completedResponse()));
  const types = events.map((e) => e.type);

  assert.equal(types[0], "response.created");
  assert.ok(types.includes("response.in_progress"));
  assert.ok(types.includes("response.output_item.added"));
  assert.ok(types.includes("response.output_text.delta"));
  assert.equal(types[types.length - 1], "response.completed");

  const delta = events.find((e) => e.type === "response.output_text.delta");
  assert.equal(delta?.data.delta, "PONG");

  const completed = events.find((e) => e.type === "response.completed");
  assert.equal(completed?.data.response.status, "completed");
  assert.equal(completed?.data.response.output.length, 2);
  assert.equal(completed?.data.response.usage.total_tokens, 12);
});

test("every event increments sequence_number", () => {
  const events = parseEvents(synthesizeResponsesSseFromJson(completedResponse()));
  events.forEach((event, index) => {
    assert.equal(event.data.sequence_number, index);
  });
});

test("non-record input yields an empty body", () => {
  assert.equal(synthesizeResponsesSseFromJson("nope"), "");
  assert.equal(synthesizeResponsesSseFromJson(null), "");
});

test("buildResponsesSseResponse sets SSE headers without content-length", () => {
  const response = buildResponsesSseResponse(completedResponse(), {
    "Content-Type": "application/json",
    "Content-Length": "999",
    "X-OmniRoute-Model": "deepseek-v4.1-flash",
  });

  assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("x-omniroute-model"), "deepseek-v4.1-flash");
});
