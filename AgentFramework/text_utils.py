import re


def is_code_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith(("-", "*", "1.", "2.", "3.")):
        return False
    if re.match(r"^(import|from)\s+\w+", stripped):
        return True
    if re.match(r"^(def|class)\s+\w+", stripped):
        return True
    if re.match(r"^(if|elif|else|for|while|try|except|with)\b", stripped):
        return True
    if re.match(r"^(const|let|var|function|export|import)\b", stripped):
        return True
    if stripped.startswith(("@", "#include", "<")):
        return True
    if stripped.endswith(("{", "}", ";")):
        return True
    if re.search(r"\b[A-Za-z_]\w*\s*=\s*[^=]", stripped):
        return True
    return False


def looks_like_code(text: str) -> bool:
    if not text:
        return False
    if "```" in text:
        return True
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return False
    code_lines = sum(1 for line in lines if is_code_line(line))
    return code_lines >= max(2, int(len(lines) * 0.4))


def detect_code_language(text: str) -> str:
    lowered = text.lower()
    if re.search(r"\b(import|from|def|class)\b", lowered) or "streamlit" in lowered or "st." in lowered:
        return "python"
    if re.search(r"\b(const|let|var|function|export|import)\b", lowered) or "=>" in lowered:
        return "javascript"
    if re.search(r"^\s*<", text, re.MULTILINE):
        return "html"
    if text.strip().startswith(("{", "[")):
        return "json"
    return ""


def wrap_code_block(text: str, indent: str = "") -> str:
    if not text:
        return text
    if "```" in text:
        return text
    lang = detect_code_language(text)
    fence = f"{indent}```{lang}".rstrip()
    lines = [fence]
    for line in text.splitlines():
        lines.append(f"{indent}{line}")
    lines.append(f"{indent}```")
    return "\n".join(lines)


def wrap_code_block_if_needed(text: str) -> str:
    if not looks_like_code(text):
        return text
    return wrap_code_block(text)
