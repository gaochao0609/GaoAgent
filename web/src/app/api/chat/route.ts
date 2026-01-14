import type { UIMessage } from "ai";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

export const runtime = "nodejs";

const BACKEND_URL = process.env.HELLOAGENT_BACKEND_URL ?? "http://localhost:8000";

const getMessageText = (message: UIMessage) =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();

const getLatestUserText = (messages: UIMessage[]) => {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  return latestUser ? getMessageText(latestUser) : "";
};

const normalizeAnswer = (text: string) =>
  text
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const streamAnswer = async (
  text: string,
  writer: { write: (part: any) => void },
  textId: string
) => {
  if (!text) {
    return;
  }
  writer.write({ type: "text-delta", id: textId, delta: text });
};

type AgentPayload = {
  prompt: string;
  conversation_id: string;
  trace?: boolean;
  stream_delta?: boolean;
};

type AgentTranscriptItem = {
  source: string;
  content: string;
};

type AgentResult = {
  status?: "completed" | "input_required";
  answer: string;
  transcript?: AgentTranscriptItem[];
  trace?: string;
  state?: unknown;
  streamed?: boolean;
};

type AgentStreamEvent =
  | { type: "transcript"; source: string; content: string }
  | { type: "delta"; delta: string }
  | {
      type: "final";
      status?: "completed" | "input_required";
      answer: string;
      trace?: string;
      state?: unknown;
      streamed?: boolean;
    }
  | { type: string; [key: string]: unknown };

const parseTranscript = (value: unknown): AgentTranscriptItem[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as { source?: unknown; content?: unknown };
      if (typeof record.source !== "string" || typeof record.content !== "string") {
        return null;
      }
      const content = record.content.trim();
      if (!content) {
        return null;
      }
      return { source: record.source, content };
    })
    .filter((item): item is AgentTranscriptItem => item !== null);
  return items.length > 0 ? items : undefined;
};

const parseStreamEvent = (line: string): AgentStreamEvent | null => {
  if (!line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line) as AgentStreamEvent;
    return parsed;
  } catch {
    return null;
  }
};

const parseFinalResult = (value: unknown): AgentResult | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as {
    status?: unknown;
    answer?: unknown;
    trace?: unknown;
    state?: unknown;
    transcript?: unknown;
    streamed?: unknown;
  };
  if (typeof record.answer !== "string") {
    return null;
  }
  return {
    status:
      record.status === "input_required" || record.status === "completed"
        ? (record.status as AgentResult["status"])
        : undefined,
    answer: record.answer,
    trace: typeof record.trace === "string" ? record.trace : undefined,
    state: record.state,
    transcript: parseTranscript(record.transcript),
    streamed: typeof record.streamed === "boolean" ? record.streamed : undefined,
  };
};

const streamHelloAgentHttp = async (
  payload: AgentPayload,
  writer: { write: (part: any) => void },
  textId: string
): Promise<AgentResult> => {
  const response = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Backend error ${response.status}`);
  }

  if (!response.body) {
    const text = await response.text();
    const parsed = parseStreamEvent(text);
    const finalResult = parseFinalResult(parsed) ?? parseFinalResult(JSON.parse(text));
    if (finalResult) {
      return finalResult;
    }
    throw new Error("Backend did not return a stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: AgentResult | null = null;
  let sawDelta = false;

  const handleEvent = (event: AgentStreamEvent) => {
    if (event.type === "transcript") {
      return;
    }
    if (event.type === "delta") {
      if (typeof event.delta === "string" && event.delta.length > 0) {
        writer.write({ type: "text-delta", id: textId, delta: event.delta });
        sawDelta = true;
      }
      return;
    }
    if (event.type === "final") {
      finalResult = parseFinalResult(event) ?? finalResult;
      return;
    }
    const maybeFinal = parseFinalResult(event);
    if (maybeFinal) {
      finalResult = maybeFinal;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseStreamEvent(line);
      if (parsed) {
        handleEvent(parsed);
      }
    }
  }

  if (buffer.trim()) {
    const parsed = parseStreamEvent(buffer.trim());
    if (parsed) {
      handleEvent(parsed);
    }
  }

  if (!finalResult) {
    throw new Error("Backend did not return a final response.");
  }

  const result = finalResult as AgentResult;
  if (sawDelta && result.streamed === undefined) {
    result.streamed = true;
  }
  return result;
};

export async function POST(req: Request) {
  const payload = await req.json();
  const messages = payload?.messages as UIMessage[] | undefined;

  if (!Array.isArray(messages)) {
    return new Response("Invalid messages payload.", { status: 400 });
  }

  const prompt = getLatestUserText(messages);
  if (!prompt) {
    return new Response("No user prompt found.", { status: 400 });
  }

  const conversationId = payload?.conversationId ?? "default";
  const shouldIncludeTrace = process.env.HELLOAGENT_TRACE !== "0";
  const shouldStreamDelta = process.env.HELLOAGENT_STREAM_DELTA !== "0";
  const agentPayload: AgentPayload = {
    prompt,
    conversation_id: conversationId,
    trace: shouldIncludeTrace,
    stream_delta: shouldStreamDelta,
  };

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const textId = crypto.randomUUID();
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: textId });
      try {
        const result = await streamHelloAgentHttp(agentPayload, writer, textId);
        const normalized = normalizeAnswer(result.answer);
        if (normalized && !result.streamed) {
          await streamAnswer(normalized, writer, textId);
        }
        writer.write({ type: "text-end", id: textId });
        if (result.trace) {
          writer.write({ type: "data-trace", data: result.trace });
        }
        writer.write({ type: "finish", finishReason: "stop" });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Backend error, please retry.";
        writer.write({ type: "text-delta", id: textId, delta: message });
        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish", finishReason: "error" });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
