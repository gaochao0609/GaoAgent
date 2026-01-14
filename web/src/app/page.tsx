"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";

type Conversation = {
  id: string;
  title: string;
  messages: UIMessage[];
};

type MessageBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string };

const DEFAULT_ID = "default";
const DEFAULT_TITLE = "新对话";
const getNumberEnv = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
};
const TYPEWRITER_TICK_MS = getNumberEnv(process.env.NEXT_PUBLIC_TYPEWRITER_TICK_MS, 30, 0, 2000);
const TYPEWRITER_CHARS_PER_TICK = getNumberEnv(
  process.env.NEXT_PUBLIC_TYPEWRITER_CHARS_PER_TICK,
  2,
  1,
  20
);

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const copyTextToClipboard = async (text: string) => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn("Clipboard write failed", error);
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  return success;
};

const usePageVisibility = () => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const updateVisibility = () => {
      setVisible(!document.hidden);
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  return visible;
};

const normalizeMessageText = (text: string) =>
  text
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const getMessageText = (message: UIMessage) =>
  normalizeMessageText(
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
  );

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}...` : text;

const deriveTitle = (messages: UIMessage[]) => {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) {
    return DEFAULT_TITLE;
  }
  const text = getMessageText(firstUser);
  return text ? truncate(text, 16) : DEFAULT_TITLE;
};

const getPreview = (messages: UIMessage[]) => {
  const lastText = [...messages]
    .reverse()
    .map((message) => getMessageText(message))
    .find((text) => text.length > 0);
  return lastText ? truncate(lastText, 42) : "暂无消息";
};

const parseMessageBlocks = (text: string): MessageBlock[] => {
  if (!text) {
    return [];
  }

  const blocks: MessageBlock[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered: boolean | null = null;

  const flushCodeBlock = (language: string, codeLines: string[]) => {
    blocks.push({
      type: "code",
      language,
      code: codeLines.join("\n"),
    });
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0 || listOrdered === null) {
      listItems = [];
      listOrdered = null;
      return;
    }
    blocks.push({ type: "list", ordered: listOrdered, items: listItems });
    listItems = [];
    listOrdered = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flushList();
      flushParagraph();
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const fence = lines[j].trim();
        if (fence.startsWith("```")) {
          i = j;
          break;
        }
        codeLines.push(lines[j]);
        if (j === lines.length - 1) {
          i = j;
        }
      }
      flushCodeBlock(language, codeLines);
      continue;
    }
    if (!trimmed) {
      flushList();
      flushParagraph();
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)[.)、]\s*(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listOrdered === false) {
        flushList();
      }
      listOrdered = true;
      listItems.push(orderedMatch[2] || trimmed);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s*(.*)$/) ?? trimmed.match(/^\u2022\s*(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listOrdered === true) {
        flushList();
      }
      listOrdered = false;
      listItems.push(unorderedMatch[1] || trimmed);
      continue;
    }

    const semicolonSegments = trimmed
      .split(/[；;]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (semicolonSegments.length > 1 || /[；;]$/.test(trimmed)) {
      flushParagraph();
      if (listOrdered === true) {
        flushList();
      }
      listOrdered = false;
      for (const segment of semicolonSegments) {
        listItems.push(segment);
      }
      continue;
    }

    if (/[:：]$/.test(trimmed) && trimmed.length <= 36) {
      flushList();
      flushParagraph();
      blocks.push({ type: "heading", text: trimmed });
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushList();
  flushParagraph();

  return blocks;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const normalizeLanguage = (language: string) => {
  const lowered = language.trim().toLowerCase();
  if (!lowered) {
    return "plain";
  }
  if (lowered.includes("python") || lowered === "py") {
    return "python";
  }
  if (lowered.includes("typescript") || lowered === "ts") {
    return "typescript";
  }
  if (lowered.includes("javascript") || lowered === "js" || lowered === "jsx") {
    return "javascript";
  }
  if (lowered.includes("html") || lowered.includes("xml")) {
    return "html";
  }
  if (lowered.includes("json")) {
    return "json";
  }
  return lowered;
};

const CODE_KEYWORDS: Record<string, string[]> = {
  python: [
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "false",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "none",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "true",
    "try",
    "while",
    "with",
    "yield",
  ],
  javascript: [
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "yield",
  ],
  typescript: [
    "abstract",
    "any",
    "as",
    "asserts",
    "async",
    "await",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "constructor",
    "continue",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "infer",
    "interface",
    "is",
    "keyof",
    "let",
    "module",
    "namespace",
    "never",
    "new",
    "null",
    "number",
    "object",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "string",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "unique",
    "unknown",
    "var",
    "void",
    "while",
    "with",
    "yield",
  ],
  json: ["true", "false", "null"],
};

const highlightLine = (line: string, language: string) => {
  if (!line) {
    return "&nbsp;";
  }

  const lang = normalizeLanguage(language);
  const keywordList = CODE_KEYWORDS[lang] ?? [];
  const keywordRegex =
    keywordList.length > 0 ? new RegExp(`\\b(${keywordList.join("|")})\\b`, "gi") : null;
  const numberRegex = /\b\d+(\.\d+)?\b/g;

  let commentIndex = -1;
  if (lang === "python") {
    commentIndex = line.indexOf("#");
  } else if (lang === "javascript" || lang === "typescript") {
    commentIndex = line.indexOf("//");
  } else if (lang === "html") {
    commentIndex = line.indexOf("<!--");
  }

  const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";

  const stringRegex = /`[^`]*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g;
  const tokens: Array<{ type: "text" | "string"; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(codePart)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: codePart.slice(lastIndex, match.index) });
    }
    tokens.push({ type: "string", value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < codePart.length) {
    tokens.push({ type: "text", value: codePart.slice(lastIndex) });
  }

  const htmlParts: string[] = [];
  for (const token of tokens) {
    if (token.type === "string") {
      htmlParts.push(`<span class="code-token string">${escapeHtml(token.value)}</span>`);
      continue;
    }
    let escaped = escapeHtml(token.value);
    if (keywordRegex) {
      escaped = escaped.replace(
        keywordRegex,
        '<span class="code-token keyword">$1</span>'
      );
    }
    escaped = escaped.replace(numberRegex, '<span class="code-token number">$&</span>');
    htmlParts.push(escaped);
  }

  if (commentPart) {
    htmlParts.push(
      `<span class="code-token comment">${escapeHtml(commentPart)}</span>`
    );
  }

  return htmlParts.join("") || "&nbsp;";
};

const CodeBlock = ({ language, code }: { language: string; code: string }) => {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.split("\n"), [code]);
  const languageClass = language ? `language-${language}` : undefined;

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const success = await copyTextToClipboard(code);
    setCopied(success);
  };

  return (
    <div className="code-block">
      <button
        type="button"
        className={`code-copy${copied ? " copied" : ""}`}
        onClick={handleCopy}
        aria-label="复制代码"
        title="复制代码"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre className="message-code">
        <code className={languageClass}>
          {lines.map((line, lineIndex) => (
            <span
              key={`${lineIndex}`}
              className="code-line"
              dangerouslySetInnerHTML={{
                __html: highlightLine(line, language),
              }}
            />
          ))}
        </code>
      </pre>
    </div>
  );
};

const renderMessageContent = (rawText: string) => {
  const normalized = normalizeMessageText(rawText);
  if (!normalized) {
    return <span className="message-muted">（非文本内容）</span>;
  }

  const blocks = parseMessageBlocks(normalized);
  if (blocks.length === 0) {
    return <span className="message-muted">（非文本内容）</span>;
  }

  return blocks.map((block, index) => {
    if (block.type === "heading") {
      return (
        <div key={`h-${index}`} className="message-heading">
          {block.text}
        </div>
      );
    }

    if (block.type === "list") {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={`l-${index}`} className="message-list">
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{item}</li>
          ))}
        </ListTag>
      );
    }

    if (block.type === "code") {
      return <CodeBlock key={`c-${index}`} language={block.language} code={block.code} />;
    }

    return <p key={`p-${index}`}>{block.text}</p>;
  });
};

const useTypewriter = (text: string, active: boolean) => {
  const [displayed, setDisplayed] = useState(active ? "" : text);
  const indexRef = useRef(active ? 0 : text.length);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
    if (!active || TYPEWRITER_TICK_MS <= 0) {
      indexRef.current = text.length;
      setDisplayed(text);
      return;
    }
    if (text.length < indexRef.current) {
      indexRef.current = 0;
      setDisplayed("");
    }
  }, [text, active]);

  useEffect(() => {
    if (!active || TYPEWRITER_TICK_MS <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      const target = textRef.current;
      if (indexRef.current >= target.length) {
        window.clearInterval(timer);
        return;
      }
      indexRef.current = Math.min(target.length, indexRef.current + TYPEWRITER_CHARS_PER_TICK);
      setDisplayed(target.slice(0, indexRef.current));
    }, TYPEWRITER_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  return active ? displayed : text;
};

const TypewriterMessage = ({ text, active }: { text: string; active: boolean }) => {
  const displayed = useTypewriter(text, active);
  return <>{renderMessageContent(displayed)}</>;
};

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    { id: DEFAULT_ID, title: DEFAULT_TITLE, messages: [] },
  ]);
  const [activeId, setActiveId] = useState(DEFAULT_ID);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pageVisible = usePageVisibility();

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeId) ??
      conversations[0],
    [activeId, conversations]
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: activeId,
    messages: activeConversation?.messages ?? [],
  });

  const isBusy = status === "submitted" || status === "streaming";
  const isError = status === "error";
  const statusLabel =
    status === "ready" ? "就绪" : status === "error" ? "出错" : "生成中";

  useEffect(() => {
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== activeId) {
          return conversation;
        }
        const title =
          conversation.title === DEFAULT_TITLE
            ? deriveTitle(messages)
            : conversation.title;
        return { ...conversation, messages, title };
      })
    );
  }, [activeId, messages]);

  useEffect(() => {
    setInput("");
  }, [activeId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight);
    const minHeight = lineHeight * 4;
    const maxHeight = lineHeight * 8;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
  }, [input, activeId]);

  const handleNewConversation = () => {
    const id = createId();
    if (status !== "ready") {
      stop();
    }
    setConversations((prev) => [
      { id, title: DEFAULT_TITLE, messages: [] },
      ...prev,
    ]);
    setActiveId(id);
  };

  const handleSelectConversation = (id: string) => {
    if (id === activeId) {
      return;
    }
    if (status !== "ready") {
      stop();
    }
    setActiveId(id);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isBusy) {
      return;
    }
    setInput("");
    await sendMessage(
      { text },
      {
        body: {
          conversationId: activeId,
        },
      }
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSend();
  };

  const renderName = (role: UIMessage["role"]) => {
    if (role === "user") {
      return "你";
    }
    if (role === "assistant") {
      return "助手";
    }
    return "系统";
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            智能<span>助手</span>
          </div>
          <button className="new-chat" type="button" onClick={handleNewConversation}>
            + 新对话
          </button>
          <div className="mode-actions" role="group" aria-label="功能模式">
            <Link className="mode-button" href="/image">
              图片生成
            </Link>
            <Link className="mode-button" href="/video">
              视频生成
            </Link>
          </div>
        </div>
        <div className="conversation-list" role="listbox" aria-label="对话列表">
          {conversations.map((conversation, index) => (
            <button
              key={conversation.id}
              type="button"
              className={`conversation-item${
                conversation.id === activeId ? " active" : ""
              }`}
              onClick={() => handleSelectConversation(conversation.id)}
              role="option"
              aria-selected={conversation.id === activeId}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <div className="conversation-title">{conversation.title}</div>
              <div className="conversation-preview">
                {getPreview(conversation.messages)}
              </div>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-profile">
            <div className="profile-avatar">你</div>
            <div className="profile-meta">
              <div className="profile-name">访客模式</div>
              <div className="profile-note">本地临时会话，不会自动保存。</div>
            </div>
          </div>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <div className="chat-title">{activeConversation?.title}</div>
            <div className="chat-subtitle">后端智能服务</div>
          </div>
          <div className="status-indicator">
            <span
              className={`status-dot${isBusy ? " busy" : ""}${
                isError ? " error" : ""
              }`}
            />
            <span>{statusLabel}</span>
          </div>
        </header>

        <div className="chat-scroll">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">开始你的第一句话</div>
              <div>左侧可切换不同对话</div>
            </div>
          ) : (
            messages.map((message, index) => {
              const text = getMessageText(message);
              const rowClass = message.role === "user" ? "user" : "assistant";
              const tracePart = message.parts.find(
                (part) => part.type === "data-trace"
              );
              const traceText =
                tracePart &&
                "data" in tracePart &&
                typeof tracePart.data === "string"
                  ? tracePart.data
                  : "";
              const shouldTypewriter = message.role === "assistant";
              return (
                <div
                  key={message.id}
                  className={`message-row ${rowClass}`}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div className="message-bubble">
                    <div className="message-name">{renderName(message.role)}</div>
                    {text ? (
                      <div className="message-text">
                        {shouldTypewriter ? (
                          <TypewriterMessage text={text} active={pageVisible} />
                        ) : (
                          renderMessageContent(text)
                        )}
                      </div>
                    ) : null}
                    {traceText ? (
                      <details className="message-trace">
                        <summary>查看执行过程</summary>
                        <pre>{traceText}</pre>
                      </details>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          {error ? (
            <div className="chat-error">
              {error.message || "请求失败，请稍后重试。"}
            </div>
          ) : null}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <div className="composer-inner">
            <textarea
              ref={textareaRef}
              name="prompt"
              placeholder="输入你的问题，回车发送，Shift+Enter 换行"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              disabled={isBusy}
            />
            <div className="composer-actions">
              <button
                className="send-button"
                type="submit"
                disabled={isBusy || input.trim().length === 0}
                aria-label="发送"
              >
                发送
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
