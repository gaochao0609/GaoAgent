import Link from "next/link";
import { truncate } from "../lib/utils";

type Conversation = {
  id: string;
  title: string;
  messages: any[];
};

interface SidebarProps {
  conversations: Conversation[];
  activeId: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

const getPreview = (messages: any[]) => {
  const lastText = [...messages]
    .reverse()
    .map((message) => {
      const text = message.parts
        ?.filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("")
        .replace(/\\n/g, "\n")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return text || "";
    })
    .find((text) => text.length > 0);
  return lastText ? truncate(lastText, 42) : "暂无消息";
};

export function Sidebar({
  conversations,
  activeId,
  onSelectConversation,
  onNewConversation,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          智能<span>助手</span>
        </div>
        <button className="new-chat" type="button" onClick={onNewConversation}>
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
            className={`conversation-item${conversation.id === activeId ? " active" : ""}`}
            onClick={() => onSelectConversation(conversation.id)}
            role="option"
            aria-selected={conversation.id === activeId}
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="conversation-title">{conversation.title}</div>
            <div className="conversation-preview">{getPreview(conversation.messages)}</div>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-profile">
          <div className="profile-avatar">访</div>
          <div className="profile-meta">
            <div className="profile-name">访客模式</div>
            <div className="profile-note">本地临时会话，不会自动保存。</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
