"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Sidebar } from "@/components/Sidebar";
import { ChatPanel, deriveTitle } from "@/components/ChatPanel";
import { createId } from "@/lib/utils";

type Conversation = {
  id: string;
  title: string;
  messages: any[];
};

const DEFAULT_ID = "default";
const DEFAULT_TITLE = "新对话";

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    { id: DEFAULT_ID, title: DEFAULT_TITLE, messages: [] },
  ]);
  const [activeId, setActiveId] = useState(DEFAULT_ID);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!textarea) return;
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
    if (id === activeId) return;
    if (status !== "ready") {
      stop();
    }
    setActiveId(id);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isBusy) return;
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

  return (
    <div className="app-shell">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />

      <ChatPanel
        title={activeConversation?.title || DEFAULT_TITLE}
        messages={messages}
        status={status}
        error={error}
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        onStop={stop}
        textareaRef={textareaRef}
      />
    </div>
  );
}
