import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from text_utils import wrap_code_block_if_needed as _wrap_code_block_if_needed

from openai import OpenAI


AGENT_SYSTEM_PROMPT_TEMPLATE = """
你是一个智能旅行助手。你的任务是分析用户的请求，并使用可用技能一步步地解决问题。

# 可用技能(元数据):
{available_skills}

# 技能调用:
- 使用 `run_skill(name="skill-name", ...)` 执行技能。
- `name` 指定技能名，其余参数作为技能输入。
- 缺少关键参数时先向用户澄清，不要臆测。
- 遵守技能描述中的依赖关系和顺序要求。

# 可用工具:
- `run_skill(name: str, **kwargs)`: 执行技能目录下的 `scripts/run.py`。

# 行动格式:
你的回答必须严格遵循以下格式。首先是你的思考过程，然后是你要执行的具体行动，每次回复只输出一对Thought-Action：
Thought: [这里是你的思考过程和下一步计划]
Action: [这里是你要调用的工具，格式为 function_name(arg_name="arg_value")]
不要输出Observation，不要模拟工具返回结果或追加解释性文本。
Thought/Action 标签必须使用英文大写并带冒号，且各占一行。

# 任务完成:
当你收集到足够的信息，能够回答用户的最终问题时，你必须在`Action:`字段后使用 `finish(answer="...")` 来输出最终答案。
最终回答请使用多行分段，包含天气：、出行建议：、推荐景点：三个标题行；标题行后用列表(- 或 1./2.)。

请开始吧！
"""

DEFAULT_USER_PROMPT = "你好，请帮我查询一下今天北京的天气，然后根据天气推荐一个合适的旅游景点。"
BASE_URL = (
    os.environ.get("LLM_BASE_URL")
    or os.environ.get("OPENAI_BASE_URL")
    # or "https://generativelanguage.googleapis.com/v1beta/openai/"
    or "https://api.openai.com/v1"
)
MODEL_ID = (
    os.environ.get("LLM_MODEL")
    or os.environ.get("OPENAI_MODEL")
    # or "gemini-3-flash-preview"
    or "gpt-5-mini"
)
API_KEY = (
    os.environ.get("LLM_API_KEY")
    #or os.environ.get("GEMINI_API_KEY")
    or os.environ.get("OPENAI_API_KEY")
)
SKILLS_ROOT = os.path.join(os.path.dirname(__file__), "skills")




class OpenAICompatibleClient:
    """
    一个用于调用任何兼容OpenAI接口的LLM服务的客户端。
    """

    def __init__(self, model: str, api_key: str, base_url: str, verbose: bool = False):
        self.model = model
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.verbose = verbose

    def _log(self, message: str) -> None:
        if self.verbose:
            print(message, file=sys.stderr)

    def generate(self, prompt: str, system_prompt: str) -> str:
        """调用LLM API来生成回应。"""
        self._log("正在调用大语言模型...")
        try:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=False,
            )
            answer = response.choices[0].message.content
            self._log("大语言模型响应成功。")
            return answer
        except Exception as exc:
            self._log(f"调用LLM API时发生错误: {exc}")
            return f"错误:调用语言模型服务时出错 - {exc}"

    def generate_stream(
        self,
        prompt: str,
        system_prompt: str,
        on_delta: Optional[Callable[[str], None]] = None,
    ) -> str:
        """调用LLM API并流式获取回应。"""
        self._log("正在调用大语言模型(流式)...")
        try:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
            stream = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True,
            )
            full_text = ""
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if not delta:
                    continue
                full_text += delta
                if on_delta:
                    on_delta(delta)
            self._log("大语言模型响应成功。")
            return full_text
        except Exception as exc:
            self._log(f"调用LLM API时发生错误: {exc}")
            return f"错误:调用语言模型服务时出错 - {exc}"


def _log(message: str, verbose: bool) -> None:
    if verbose:
        print(message, file=sys.stderr)


def build_llm(verbose: bool) -> OpenAICompatibleClient:
    api_key = API_KEY
    if not api_key:
        raise ValueError("未配置LLM_API_KEY或OPENAI_API_KEY环境变量。")
    return OpenAICompatibleClient(
        model=MODEL_ID,
        api_key=api_key,
        base_url=BASE_URL,
        verbose=verbose,
    )


@dataclass(frozen=True)
class SkillMetadata:
    name: str
    description: str
    path: str


def _parse_frontmatter(content: str) -> Dict[str, str]:
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}

    data: Dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            continue
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def discover_skills(skills_root: str) -> Dict[str, SkillMetadata]:
    skills: Dict[str, SkillMetadata] = {}
    if not os.path.isdir(skills_root):
        return skills

    for entry in sorted(os.listdir(skills_root)):
        skill_dir = os.path.join(skills_root, entry)
        if not os.path.isdir(skill_dir):
            continue
        skill_path = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(skill_path):
            continue
        try:
            with open(skill_path, "r", encoding="utf-8") as handle:
                content = handle.read()
        except OSError:
            continue
        frontmatter = _parse_frontmatter(content)
        name = frontmatter.get("name") or entry
        description = frontmatter.get("description", "")
        skills[name] = SkillMetadata(name=name, description=description, path=skill_path)
    return skills


def _escape_xml(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def skills_to_prompt(skills: Dict[str, SkillMetadata]) -> str:
    if not skills:
        return "<available_skills />"

    lines = ["<available_skills>"]
    for skill in skills.values():
        lines.append("  <skill>")
        lines.append(f"    <name>{_escape_xml(skill.name)}</name>")
        lines.append(f"    <description>{_escape_xml(skill.description)}</description>")
        lines.append("  </skill>")
    lines.append("</available_skills>")
    return "\n".join(lines)


def build_system_prompt(skills: Dict[str, SkillMetadata]) -> str:
    return AGENT_SYSTEM_PROMPT_TEMPLATE.format(
        available_skills=skills_to_prompt(skills)
    )


SKILLS_INDEX = discover_skills(SKILLS_ROOT)


def run_skill(**kwargs: str) -> str:
    name = kwargs.pop("name", "").strip()
    if not name:
        return "错误:未提供技能名称。"
    skill = SKILLS_INDEX.get(name)
    if not skill:
        return f"错误:未找到技能 '{name}'。"

    skill_dir = os.path.dirname(skill.path)
    script_path = os.path.join(skill_dir, "scripts", "run.py")
    if not os.path.isfile(script_path):
        return f"错误:技能 '{name}' 缺少 scripts/run.py。"

    try:
        input_payload = json.dumps(kwargs, ensure_ascii=False)
    except TypeError as exc:
        return f"错误:技能输入无法序列化 - {exc}"

    try:
        result = subprocess.run(
            [sys.executable, script_path],
            input=input_payload.encode("utf-8"),
            capture_output=True,
            text=False,
            timeout=30,
            check=False,
        )
    except Exception as exc:
        return f"错误:执行技能失败 - {exc}"

    def _decode_output(data: bytes) -> str:
        return data.decode("utf-8", errors="replace").strip()

    if result.returncode != 0:
        stderr = _decode_output(result.stderr or b"")
        return f"错误:技能脚本执行失败 - {stderr or 'unknown error'}"

    output = _decode_output(result.stdout or b"")
    if not output:
        return "错误:技能脚本无输出。"
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        return f"错误:技能脚本输出非JSON - {output}"
    if not isinstance(payload, dict):
        return "错误:技能脚本输出格式无效。"
    if not payload.get("ok", False):
        error = payload.get("error", "unknown error")
        return f"错误:{error}"
    if "result" in payload:
        return str(payload["result"])
    return json.dumps(payload, ensure_ascii=False)


available_tools = {
    "run_skill": run_skill,
}


def truncate_thought_action(llm_output: str) -> str:
    match = re.search(
        r"(Thought:.*?Action:.*?)(?=\n\s*(?:Thought:|Action:|Observation:)|\Z)",
        llm_output,
        re.DOTALL,
    )
    if match:
        return match.group(1).strip()
    return llm_output.strip()


def extract_kwargs(args_str: str) -> Dict[str, str]:
    return dict(re.findall(r'(\w+)="([^"]*)"', args_str))


def format_answer_for_ui(text: str) -> str:
    if "\n" in text:
        return text.strip()
    updated = text
    updated = re.sub(r"\s*出行建议[:：]\s*", "\n\n出行建议：\n", updated)
    updated = re.sub(r"\s*注意事项[:：]\s*", "\n\n注意事项：\n", updated)
    updated = re.sub(r"\s*推荐景点[:：]\s*", "\n\n推荐景点：\n", updated)
    updated = re.sub(r"([。！？!?])\s*(如需|需要我)", r"\1\n\n\2", updated)
    updated = re.sub(r"(?<!\n)(\d+[)\.、])\s*", r"\n\1 ", updated)
    updated = re.sub(r"\n{3,}", "\n\n", updated)
    return updated.strip()


def normalize_answer(text: str) -> str:
    cleaned = text.replace("\\n", "\n").replace("\\t", "\t")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return format_answer_for_ui(cleaned)



def _emit_transcript_event(
    emitter: Optional[Callable[[Dict[str, str]], None]],
    source: str,
    content: str,
) -> None:
    if not emitter:
        return
    if not content or not content.strip():
        return
    emitter({"type": "transcript", "source": source, "content": content})


def _decode_escape_char(ch: str) -> str:
    if ch == "n":
        return "\n"
    if ch == "t":
        return "\t"
    if ch == '"':
        return '"'
    if ch == "\\":
        return "\\"
    return ch


class _FinishAnswerStreamParser:
    def __init__(self, emit: Callable[[str], None]):
        self._emit = emit
        self._prefix = 'finish(answer="'
        self._prefix_index = 0
        self._in_answer = False
        self._escape = False
        self._done = False

    def feed(self, chunk: str) -> None:
        if self._done or not chunk:
            return
        for ch in chunk:
            if self._done:
                return
            if not self._in_answer:
                if ch == self._prefix[self._prefix_index]:
                    self._prefix_index += 1
                    if self._prefix_index == len(self._prefix):
                        self._in_answer = True
                        self._prefix_index = 0
                else:
                    self._prefix_index = 1 if ch == self._prefix[0] else 0
                continue
            if self._escape:
                self._escape = False
                self._emit(_decode_escape_char(ch))
                continue
            if ch == "\\":
                self._escape = True
                continue
            if ch == '"':
                self._done = True
                self._in_answer = False
                continue
            self._emit(ch)


def _build_delta_emitter(
    emitter: Optional[Callable[[Dict[str, str]], None]]
) -> Tuple[Callable[[str], None], Callable[[], None], Callable[[], bool]]:
    buffer: List[str] = []
    size = 0
    streamed = False

    def emit(text: str) -> None:
        nonlocal size, streamed
        if not emitter or not text:
            return
        streamed = True
        buffer.append(text)
        size += len(text)
        if size >= 12 or text.endswith("\n"):
            emitter({"type": "delta", "delta": "".join(buffer)})
            buffer.clear()
            size = 0

    def flush() -> None:
        nonlocal size
        if not emitter or not buffer:
            return
        emitter({"type": "delta", "delta": "".join(buffer)})
        buffer.clear()
        size = 0

    def is_streamed() -> bool:
        return streamed

    return emit, flush, is_streamed


def _run_agent(
    user_prompt: str,
    max_turns: int = 5,
    verbose: bool = False,
    return_trace: bool = False,
    emitter: Optional[Callable[[Dict[str, str]], None]] = None,
    stream_deltas: bool = False,
) -> Tuple[str, Optional[str], bool]:
    if not user_prompt or not user_prompt.strip():
        message = "错误:用户输入为空。"
        _emit_transcript_event(emitter, "System", message)
        return message, None

    try:
        llm = build_llm(verbose)
    except Exception as exc:
        message = f"错误:初始化语言模型失败 - {exc}"
        _emit_transcript_event(emitter, "System", message)
        return message, None

    system_prompt = build_system_prompt(SKILLS_INDEX)
    prompt_history = [f"用户请求: {user_prompt}"]
    trace_steps: List[str] = []
    last_weather: Optional[str] = None
    last_weather_city: Optional[str] = None
    last_local_time: Optional[str] = None
    last_local_time_city: Optional[str] = None

    emit_delta, flush_delta, is_streamed = _build_delta_emitter(emitter if stream_deltas else None)

    for i in range(max_turns):
        _log(f"--- 循环 {i + 1} ---", verbose)
        full_prompt = "\n".join(prompt_history)

        if stream_deltas and emitter:
            parser = _FinishAnswerStreamParser(emit_delta)
            llm_output = llm.generate_stream(
                full_prompt,
                system_prompt=system_prompt,
                on_delta=parser.feed,
            )
            flush_delta()
        else:
            llm_output = llm.generate(full_prompt, system_prompt=system_prompt)
        if llm_output.startswith("错误:调用语言模型服务时出错"):
            trace_steps.append(llm_output)
            _emit_transcript_event(emitter, "System", llm_output)
            return llm_output, ("\n".join(trace_steps) if return_trace else None), False
        llm_output = truncate_thought_action(llm_output)
        _log(f"模型输出:\n{llm_output}\n", verbose)
        prompt_history.append(llm_output)

        action_match = re.search(r"Action: (.*)", llm_output, re.DOTALL)
        if not action_match:
            trace_steps.append(llm_output)
            _emit_transcript_event(emitter, "System", "错误:模型输出中未找到 Action。")
            return "错误:模型输出中未找到 Action。", "\n".join(trace_steps) if return_trace else None, False
        action_str = action_match.group(1).strip()

        if action_str.lower().startswith("finish"):
            trace_steps.append(llm_output)
            finish_match = re.search(r'finish\(answer="([\s\S]*?)"\)', action_str)
            if not finish_match:
                _emit_transcript_event(emitter, "System", "错误:模型finish格式无效。")
                return "错误:模型finish格式无效。", "\n".join(trace_steps) if return_trace else None, False
            answer = normalize_answer(finish_match.group(1))
            answer = _wrap_code_block_if_needed(answer)
            return (
                answer,
                "\n".join(trace_steps) if return_trace else None,
                is_streamed(),
            )

        tool_match = re.search(r"(\w+)\(", action_str)
        args_match = re.search(r"\((.*)\)", action_str, re.DOTALL)
        if not tool_match or not args_match:
            observation = "错误:模型工具调用格式无效。"
            prompt_history.append(f"Observation: {observation}")
            trace_steps.append(f"{llm_output}\nObservation: {observation}")
            _emit_transcript_event(emitter, "Assistant", f"Action: {action_str}")
            _emit_transcript_event(emitter, "Tool", f"Observation: {observation}")
            continue

        tool_name = tool_match.group(1)
        args_str = args_match.group(1)
        kwargs = extract_kwargs(args_str)

        if tool_name == "run_skill" and kwargs.get("name") == "get-attraction":
            if not kwargs.get("city"):
                if last_weather_city:
                    kwargs["city"] = last_weather_city
                elif last_local_time_city:
                    kwargs["city"] = last_local_time_city

        if tool_name == "run_skill" and kwargs.get("name") == "get-attraction" and (
            not last_weather or not last_weather_city or last_weather_city != kwargs.get("city")
        ):
            observation = "错误:必须先调用 get-weather 获取该城市的真实天气，再调用 get-attraction。"
            prompt_history.append(f"Observation: {observation}")
            trace_steps.append(f"{llm_output}\nObservation: {observation}")
            _emit_transcript_event(emitter, "Assistant", f"Action: {action_str}")
            _emit_transcript_event(emitter, "Tool", f"Observation: {observation}")
            continue
        if tool_name == "run_skill" and kwargs.get("name") == "get-attraction" and (
            not last_local_time or not last_local_time_city or last_local_time_city != kwargs.get("city")
        ):
            observation = "错误:必须先调用 get-local-time 获取该城市的本地时间，再调用 get-attraction。"
            prompt_history.append(f"Observation: {observation}")
            trace_steps.append(f"{llm_output}\nObservation: {observation}")
            _emit_transcript_event(emitter, "Assistant", f"Action: {action_str}")
            _emit_transcript_event(emitter, "Tool", f"Observation: {observation}")
            continue

        _emit_transcript_event(emitter, "Assistant", f"Action: {action_str}")
        if tool_name in available_tools:
            if (
                tool_name == "run_skill"
                and kwargs.get("name") == "get-attraction"
                and last_weather
                and not kwargs.get("weather")
            ):
                kwargs["weather"] = last_weather
            if (
                tool_name == "run_skill"
                and kwargs.get("name") == "get-attraction"
                and last_local_time
                and not kwargs.get("local_time")
            ):
                kwargs["local_time"] = last_local_time
            try:
                observation = available_tools[tool_name](**kwargs)
            except TypeError as exc:
                observation = f"错误:工具参数无效 - {exc}"
        else:
            observation = f"错误:未定义的工具 '{tool_name}'"

        if tool_name == "run_skill" and kwargs.get("name") == "get-weather" and not observation.startswith("错误"):
            last_weather = observation
            last_weather_city = kwargs.get("city")
        if tool_name == "run_skill" and kwargs.get("name") == "get-local-time" and not observation.startswith("错误"):
            last_local_time = observation
            last_local_time_city = kwargs.get("city")

        prompt_history.append(f"Observation: {observation}")
        trace_steps.append(f"{llm_output}\nObservation: {observation}")
        _emit_transcript_event(emitter, "Tool", f"Observation: {observation}")

    message = "错误:超过最大循环次数，未完成任务。"
    _emit_transcript_event(emitter, "System", message)
    return message, "\n".join(trace_steps) if return_trace else None, False


def run_agent(
    user_prompt: str,
    max_turns: int = 5,
    verbose: bool = False,
    return_trace: bool = False,
) -> Tuple[str, Optional[str]]:
    answer, trace, _ = _run_agent(
        user_prompt,
        max_turns=max_turns,
        verbose=verbose,
        return_trace=return_trace,
        emitter=None,
        stream_deltas=False,
    )
    return answer, trace


def run_agent_stream(
    user_prompt: str,
    max_turns: int = 5,
    verbose: bool = False,
    return_trace: bool = False,
    emitter: Optional[Callable[[Dict[str, str]], None]] = None,
    stream_deltas: bool = True,
) -> Tuple[str, Optional[str], bool]:
    return _run_agent(
        user_prompt,
        max_turns=max_turns,
        verbose=verbose,
        return_trace=return_trace,
        emitter=emitter,
        stream_deltas=stream_deltas,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, default=None)
    parser.add_argument("--max-turns", type=int, default=5)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--stream-delta", action="store_true")
    args = parser.parse_args()

    prompt = None
    return_trace = args.trace
    stream_json = False
    stream_deltas = args.stream_delta
    env_trace = os.environ.get("HELLOAGENT_TRACE")
    env_stream_delta = os.environ.get("HELLOAGENT_STREAM_DELTA")
    if env_trace is not None:
        return_trace = env_trace == "1"
    if env_stream_delta is not None:
        stream_deltas = env_stream_delta == "1"
    if args.json:
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict):
            prompt = payload.get("prompt")
            stream_json = bool(payload.get("stream"))
            if payload.get("trace") is not None:
                return_trace = bool(payload.get("trace"))
            if payload.get("stream_delta") is not None:
                stream_deltas = bool(payload.get("stream_delta"))

    if not prompt:
        prompt = args.prompt or sys.stdin.read().strip()

    if not prompt:
        prompt = DEFAULT_USER_PROMPT

    if args.json and stream_json:
        def emit(event: Dict[str, str]) -> None:
            print(json.dumps(event, ensure_ascii=False), flush=True)

        answer, trace, streamed = run_agent_stream(
            prompt,
            max_turns=args.max_turns,
            verbose=args.verbose,
            return_trace=return_trace,
            emitter=emit,
            stream_deltas=stream_deltas,
        )
        payload = {"type": "final", "status": "completed", "answer": answer, "streamed": streamed}
        if trace:
            payload["trace"] = trace
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        return 0

    answer, trace = run_agent(
        prompt,
        max_turns=args.max_turns,
        verbose=args.verbose,
        return_trace=return_trace,
    )
    payload = {"answer": answer}
    if trace:
        payload["trace"] = trace
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
