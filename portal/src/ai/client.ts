/* ============================================================
   Talks to the Azure Function proxy ("velops-customer-ai") with
   plain browser fetch — a Power Pages code site has no CSP that
   blocks outbound requests (unlike the internal hub's code app,
   which needed a custom connector). The Function forwards the
   request to the Anthropic Messages API and pipes the SSE stream
   straight back (enableHttpStream), so assistant text streams
   into the chat as it is generated.

   The response's content array (text + tool_use + thinking
   blocks) is echoed back verbatim on the next turn for
   same-model tool continuation.
   ============================================================ */
import { MAX_TOKENS, MODEL, proxyEndpoint } from "./config";
import type { AssistantTurn, ChatMessage, ContentBlock, ToolUseBlock } from "./types";

interface PostOpts {
  /** Called with each streamed text delta (and once with full text on the non-stream fallback). */
  onText?: (delta: string) => void;
}

interface SseEvent {
  type: string;
  // The Anthropic stream event payload — shapes vary per type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Mutable accumulator for one content block while it streams. */
interface OpenBlock {
  block: ContentBlock;
  /** input_json_delta fragments for tool_use blocks. */
  partialJson: string;
}

function errorMessageFrom(payload: unknown): string {
  const p = payload as { error?: { message?: string }; message?: string } | null;
  return p?.error?.message ?? p?.message ?? "The AI proxy request failed.";
}

/** Apply one parsed SSE event to the accumulating turn state. */
function applyEvent(
  ev: SseEvent,
  blocks: OpenBlock[],
  turn: { stop_reason: string | null; model?: string },
  onText?: (d: string) => void,
): void {
  switch (ev.type) {
    case "message_start":
      turn.model = ev.message?.model;
      break;
    case "content_block_start": {
      const cb = ev.content_block ?? {};
      let block: ContentBlock;
      if (cb.type === "tool_use") {
        block = { type: "tool_use", id: cb.id, name: cb.name, input: cb.input ?? {} };
      } else if (cb.type === "thinking") {
        block = { type: "thinking", thinking: cb.thinking ?? "", signature: cb.signature };
      } else {
        block = { type: "text", text: cb.text ?? "" };
      }
      blocks[ev.index] = { block, partialJson: "" };
      break;
    }
    case "content_block_delta": {
      const open = blocks[ev.index];
      if (!open) break;
      const d = ev.delta ?? {};
      if (d.type === "text_delta" && open.block.type === "text") {
        open.block.text += d.text ?? "";
        if (d.text) onText?.(d.text);
      } else if (d.type === "input_json_delta" && open.block.type === "tool_use") {
        open.partialJson += d.partial_json ?? "";
      } else if (d.type === "thinking_delta" && open.block.type === "thinking") {
        open.block.thinking += d.thinking ?? "";
      } else if (d.type === "signature_delta" && open.block.type === "thinking") {
        open.block.signature = d.signature;
      }
      break;
    }
    case "content_block_stop": {
      const open = blocks[ev.index];
      if (open && open.block.type === "tool_use" && open.partialJson) {
        try {
          (open.block as ToolUseBlock).input = JSON.parse(open.partialJson);
        } catch {
          // Leave whatever input we had; the dispatcher validates anyway.
        }
      }
      break;
    }
    case "message_delta":
      turn.stop_reason = ev.delta?.stop_reason ?? turn.stop_reason;
      break;
    case "error":
      throw new Error(errorMessageFrom(ev));
    default:
      break; // ping, message_stop, unknown future events
  }
}

/**
 * POST the conversation to the proxy and stream the assistant turn.
 * `system` and `tools` are passed through verbatim (the STATIC system
 * block carries cache_control so the prefix caches across re-POSTs).
 */
export async function postMessages(
  messages: ChatMessage[],
  system: unknown,
  tools: unknown,
  opts: PostOpts = {},
): Promise<AssistantTurn> {
  const res = await fetch(proxyEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      messages,
      stream: true,
    }),
  });

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    let message = `AI proxy error (${res.status}).`;
    try {
      message = errorMessageFrom(JSON.parse(await res.text()));
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }

  // Non-streaming fallback (proxy forwards Anthropic errors — and any
  // non-SSE success — as JSON verbatim).
  if (!contentType.includes("text/event-stream")) {
    const data = (await res.json()) as {
      type?: string;
      content?: ContentBlock[];
      stop_reason?: string | null;
      model?: string;
      usage?: Record<string, number>;
    };
    if (data.type === "error") throw new Error(errorMessageFrom(data));
    const content = data.content ?? [];
    const text = content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) opts.onText?.(text);
    return { content, stop_reason: data.stop_reason ?? null, model: data.model, usage: data.usage };
  }

  // --- SSE parsing --------------------------------------------------
  if (!res.body) throw new Error("The AI proxy returned an empty stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const blocks: OpenBlock[] = [];
  const turn: { stop_reason: string | null; model?: string } = { stop_reason: null };

  let buffer = "";
  const handleFrame = (frame: string) => {
    // A frame may contain several lines; the payload lives on data: lines.
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: SseEvent;
      try {
        ev = JSON.parse(payload) as SseEvent;
      } catch {
        continue; // partial/garbled line — skip
      }
      applyEvent(ev, blocks, turn, opts.onText);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      handleFrame(frame);
      sep = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  return {
    content: blocks.filter(Boolean).map((b) => b.block),
    stop_reason: turn.stop_reason,
    model: turn.model,
  };
}
