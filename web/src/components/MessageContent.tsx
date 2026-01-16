import type { UIMessage } from "ai";
import { CodeBlock } from "./CodeBlock";
import { useTypewriter } from "../hooks/useTypewriter";

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

type MessageBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string };

const parseMessageBlocks = (text: string): MessageBlock[] => {
  if (!text) return [];

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
    if (paragraph.length === 0) return;
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
      if (listOrdered === false) flushList();
      listOrdered = true;
      listItems.push(orderedMatch[2] || trimmed);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s*(.*)$/) ?? trimmed.match(/^\u2022\s*(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listOrdered === true) flushList();
      listOrdered = false;
      listItems.push(unorderedMatch[1] || trimmed);
      continue;
    }

    const semicolonSegments = trimmed
      .split(/[;；]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (semicolonSegments.length > 1 || /[;；]$/.test(trimmed)) {
      flushParagraph();
      if (listOrdered === true) flushList();
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

const renderMessageBlock = (block: MessageBlock) => {
  if (block.type === "heading") {
    return <div className="message-heading">{block.text}</div>;
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className="message-list">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{item}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === "code") {
    return <CodeBlock language={block.language} code={block.code} />;
  }

  return <p>{block.text}</p>;
};

interface MessageContentProps {
  text: string;
  showTypewriter?: boolean;
  isActive?: boolean;
}

export function MessageContent({
  text,
  showTypewriter = false,
  isActive = false,
}: MessageContentProps) {
  const normalized = normalizeMessageText(text);
  if (!normalized) {
    return <span className="message-muted">（非文本内容）</span>;
  }

  const blocks = parseMessageBlocks(normalized);
  if (blocks.length === 0) {
    return <span className="message-muted">（非文本内容）</span>;
  }

  if (showTypewriter) {
    const displayed = useTypewriter(text, isActive);
    const displayedBlocks = parseMessageBlocks(displayed);
    return (
      <>
        {displayedBlocks.map((block, index) => (
          <div key={index}>{renderMessageBlock(block)}</div>
        ))}
      </>
    );
  }

  return (
    <>
      {blocks.map((block, index) => (
        <div key={index}>{renderMessageBlock(block)}</div>
      ))}
    </>
  );
}

export { getMessageText, normalizeMessageText };
