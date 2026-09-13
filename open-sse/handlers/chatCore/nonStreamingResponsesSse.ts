/**
 * Synthesize a Responses API SSE stream from an already-assembled (non-streaming)
 * Responses object.
 *
 * OmniRoute executes server-side web-search interception non-streaming: streaming
 * interception of the built-in `web_search` tool is not implemented (#9725), so a
 * `stream: true` Responses request whose `web_search` tool was converted to the
 * `omniroute_web_search` fallback is executed with `stream: false` and handed back as
 * `application/json`. Strict Responses-SSE clients (Codex / codex-rs) require the
 * `response.created` … `response.completed` contract and abort with
 * "stream closed before response.completed" when they receive a bare JSON body
 * instead. Re-wrapping the assembled response in the Responses SSE envelope
 * keeps those clients working without changing the interception result.
 *
 * Returns a string body plus the headers a Responses SSE response must carry.
 */
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sseEvent(type: string, payload: JsonRecord): string {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function synthesizeResponsesSseFromJson(response: unknown): string {
  if (!isRecord(response)) return "";

  const id = typeof response.id === "string" && response.id ? response.id : "resp_omniroute";
  const createdAt =
    typeof response.created_at === "number" ? response.created_at : Math.floor(Date.now() / 1000);
  const model = typeof response.model === "string" ? response.model : "";
  const output = Array.isArray(response.output) ? response.output : [];
  const base = { id, object: "response", created_at: createdAt, model };

  let sequenceNumber = 0;
  let out = "";
  const emit = (type: string, extra: JsonRecord) => {
    out += sseEvent(type, { type, sequence_number: sequenceNumber++, ...extra });
  };

  const inProgress = { ...base, status: "in_progress", output: [] };
  emit("response.created", { response: inProgress });
  emit("response.in_progress", { response: inProgress });

  output.forEach((item, outputIndex) => {
    const itemRecord = isRecord(item) ? item : {};
    emit("response.output_item.added", {
      output_index: outputIndex,
      item: { ...itemRecord, status: "in_progress" },
    });

    if (Array.isArray(itemRecord.content)) {
      itemRecord.content.forEach((part, contentIndex) => {
        const partRecord = isRecord(part) ? part : {};
        if (partRecord.type !== "output_text" || typeof partRecord.text !== "string") return;

        emit("response.content_part.added", {
          item_id: itemRecord.id,
          output_index: outputIndex,
          content_index: contentIndex,
          part: { ...partRecord, text: "" },
        });
        if (partRecord.text.length > 0) {
          emit("response.output_text.delta", {
            item_id: itemRecord.id,
            output_index: outputIndex,
            content_index: contentIndex,
            delta: partRecord.text,
            logprobs: [],
          });
        }
        emit("response.output_text.done", {
          item_id: itemRecord.id,
          output_index: outputIndex,
          content_index: contentIndex,
          text: partRecord.text,
          logprobs: [],
        });
        emit("response.content_part.done", {
          item_id: itemRecord.id,
          output_index: outputIndex,
          content_index: contentIndex,
          part: partRecord,
        });
      });
    }

    emit("response.output_item.done", { output_index: outputIndex, item: itemRecord });
  });

  const status = typeof response.status === "string" ? response.status : "completed";
  emit("response.completed", { response: { ...response, object: "response", status } });

  return out;
}

export function buildResponsesSseResponse(
  response: unknown,
  headers: Record<string, string>
): Response {
  const payload = synthesizeResponsesSseFromJson(response);
  const sseHeaders: Record<string, string> = { ...headers };
  for (const key of Object.keys(sseHeaders)) {
    if (key.toLowerCase() === "content-length" || key.toLowerCase() === "content-type") {
      delete sseHeaders[key];
    }
  }
  return new Response(payload, {
    headers: {
      ...sseHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
