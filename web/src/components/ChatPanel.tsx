import type { FormEvent } from "react";
import type { UIMessage } from "ai";
import { MessageContent, getMessageText } from "./MessageContent";
import { usePageVisibility } from "../hooks/usePageVisibility";

const DEFAULT_TITLE = "新对话";

const deriveTitle = (messages: UIMessage[]) => {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return DEFAULT_TITLE;
  const text = getMessageText(firstUser);
  return text ? (text.length > 16 ? `${text.slice(0, 16)}...` : text) : DEFAULT_TITLE;
};

const renderName = (role: UIMessage["role"]) => {
  if (role === "user") return "你";
  if (role === "assistant") return "助手";
  return "系统";
};

interface ChatPanelProps {
  title: string;
  messages: UIMessage[];
  status: string;
  error?: Error;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatPanel({
  title,
  messages,
  status,
  error,
  input,
  onInputChange,
  onSend,
  onStop,
  textareaRef,
}: ChatPanelProps) {
  const pageVisible = usePageVisibility();
  const isBusy = status === "submitted" || status === "streaming";
  const isError = status === "error";
  const statusLabel = status === "ready" ? "就绪" : status === "error" ? "出错" : "生成中";

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <div>
          <div className="chat-title">{title}</div>
          <div className="chat-subtitle">后端智能服务</div>
        </div>
        <div className="status-indicator">
          <span
            className={`status-dot${isBusy ? " busy" : ""}${isError ? " error" : ""}`}
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
            const tracePart = message.parts.find((part) => part.type === "data-trace");
            const traceText =
              tracePart && "data" in tracePart && typeof tracePart.data === "string"
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
                        <MessageContent text={text} showTypewriter isActive={pageVisible} />
                      ) : (
                        <MessageContent text={text} />
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
          <div className="chat-error">{error.message || "请求失败，请稍后重试。"}</div>
        ) : null}
      </div>

      <form className="composer" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
        <div className="composer-inner">
          <textarea
            ref={textareaRef}
            name="prompt"
            placeholder="输入你的问题，回车发送，Shift+Enter 换行"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
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
  );
}

export { deriveTitle };
