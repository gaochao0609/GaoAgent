import { useEffect, useMemo, useState } from "react";
import { copyTextToClipboard } from "../lib/utils";

const CODE_KEYWORDS: Record<string, string[]> = {
  python: [
    "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "false", "finally", "for",
    "from", "global", "if", "import", "in", "is", "lambda", "none",
    "nonlocal", "not", "or", "pass", "raise", "return", "true", "try",
    "while", "with", "yield",
  ],
  javascript: [
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends",
    "false", "finally", "for", "function", "if", "import", "in",
    "instanceof", "let", "new", "null", "return", "super", "switch",
    "this", "throw", "true", "try", "typeof", "var", "void", "while", "yield",
  ],
  typescript: [
    "abstract", "any", "as", "asserts", "async", "await", "boolean",
    "break", "case", "catch", "class", "const", "constructor",
    "continue", "declare", "default", "delete", "do", "else", "enum",
    "export", "extends", "false", "finally", "for", "from", "function",
    "if", "implements", "import", "in", "infer", "interface", "is",
    "keyof", "let", "module", "namespace", "never", "new", "null",
    "number", "object", "private", "protected", "public", "readonly",
    "return", "string", "super", "switch", "this", "throw", "true",
    "try", "type", "typeof", "undefined", "unique", "unknown", "var",
    "void", "while", "with", "yield",
  ],
  json: ["true", "false", "null"],
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const normalizeLanguage = (language: string) => {
  const lowered = language.trim().toLowerCase();
  if (!lowered) return "plain";
  if (lowered.includes("python") || lowered === "py") return "python";
  if (lowered.includes("typescript") || lowered === "ts") return "typescript";
  if (lowered.includes("javascript") || lowered === "js" || lowered === "jsx") return "javascript";
  if (lowered.includes("html") || lowered.includes("xml")) return "html";
  if (lowered.includes("json")) return "json";
  return lowered;
};

const highlightLine = (line: string, language: string) => {
  if (!line) return "&nbsp;";

  const lang = normalizeLanguage(language);
  const keywordList = CODE_KEYWORDS[lang] ?? [];
  const keywordRegex = keywordList.length > 0 ? new RegExp(`\\b(${keywordList.join("|")})\\b`, "gi") : null;
  const numberRegex = /\b\d+(\.\d+)?\b/g;

  let commentIndex = -1;
  if (lang === "python") commentIndex = line.indexOf("#");
  else if (lang === "javascript" || lang === "typescript") commentIndex = line.indexOf("//");
  else if (lang === "html") commentIndex = line.indexOf("<!--");

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
      escaped = escaped.replace(keywordRegex, '<span class="code-token keyword">$1</span>');
    }
    escaped = escaped.replace(numberRegex, '<span class="code-token number">$&</span>');
    htmlParts.push(escaped);
  }

  if (commentPart) {
    htmlParts.push(`<span class="code-token comment">${escapeHtml(commentPart)}</span>`);
  }

  return htmlParts.join("") || "&nbsp;";
};

interface CodeBlockProps {
  language: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.split("\n"), [code]);
  const languageClass = language ? `language-${language}` : undefined;

  useEffect(() => {
    if (!copied) return;
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
              key={lineIndex}
              className="code-line"
              dangerouslySetInnerHTML={{ __html: highlightLine(line, language) }}
            />
          ))}
        </code>
      </pre>
    </div>
  );
}
