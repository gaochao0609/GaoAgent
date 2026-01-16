export type NdjsonHandler = (payload: any) => void;

const parseLine = (line: string) => {
  if (!line.trim()) return null;
  const normalized = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
};

export const streamNdjson = async (response: Response, onPayload: NdjsonHandler) => {
  if (!response.body) {
    const text = await response.text();
    const parsed = parseLine(text);
    if (parsed) {
      onPayload(parsed);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const payload = parseLine(line);
      if (payload) {
        onPayload(payload);
      }
    }
  }

  if (buffer.trim()) {
    const payload = parseLine(buffer);
    if (payload) {
      onPayload(payload);
    }
  }
};
