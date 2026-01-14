import argparse
import asyncio
import json
import os
import re
import sys

from text_utils import (
    detect_code_language as _detect_code_language,
    is_code_line as _is_code_line,
    looks_like_code as _looks_like_code,
    wrap_code_block as _wrap_code_block,
)

from autogen_agentchat.agents import AssistantAgent, UserProxyAgent
from autogen_agentchat.conditions import FunctionalTermination
from autogen_agentchat.base import TaskResult
from autogen_agentchat.messages import BaseChatMessage
from autogen_agentchat.teams import DiGraphBuilder, GraphFlow
from autogen_agentchat.ui import Console
from autogen_ext.models.openai import OpenAIChatCompletionClient

DEFAULT_TASK = """我们需要开发一个比特币价格显示应用，具体要求如下：
            核心功能：
            - 实时显示比特币当前价格（USD）
            - 显示24小时价格变化趋势（涨跌幅和涨跌额）
            - 提供价格刷新功能

            技术要求：
            - 使用 Streamlit 框架创建 Web 应用
            - 界面简洁美观，用户友好
            - 添加适当的错误处理和加载状态

            请团队协作完成这个任务，从需求分析到最终实现。"""

INPUT_REQUIRED_TOKEN = "__USER_INPUT_REQUIRED__"
HANDOFF_REVIEW = "HANDOFF:REVIEW"
HANDOFF_QA = "HANDOFF:QA"
HANDOFF_USER = "HANDOFF:USER"
HANDOFF_ENGINEER = "HANDOFF:ENGINEER"

_DEBUG_ENABLED = os.environ.get("HELLOAGENT_DEBUG") == "1"

def _debug_log(message: str) -> None:
    if _DEBUG_ENABLED:
        print(f"[DEBUG] {message}", file=sys.stderr)

def _get_first_env(*names, default=None):
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


def create_openai_model_client():
    """创建并配置 OpenAI 模型客户端"""
    api_key = _get_first_env("LLM_API_KEY", "OPENAI_API_KEY")
    if not api_key:
        raise ValueError("Missing API key. Set LLM_API_KEY or OPENAI_API_KEY.")
    return OpenAIChatCompletionClient(
        model=_get_first_env("LLM_MODEL_ID", "LLM_MODEL", "OPENAI_MODEL", default="gpt-5-mini"),
        api_key=api_key,
        base_url=_get_first_env("LLM_BASE_URL", "OPENAI_BASE_URL", default="https://api.openai.com/v1"),
    )

def create_product_manager(model_client):
    """创建产品经理智能体"""
    system_message = """你是一位经验丰富的产品经理，专门负责软件产品的需求分析和项目规划。

你的核心职责包括：
1. **需求分析**：深入理解用户需求，识别核心功能和边界条件
2. **技术规划**：基于需求制定清晰的技术实现路径
3. **风险评估**：识别潜在的技术风险和用户体验问题
4. **协调沟通**：与工程师和其他团队成员进行有效沟通

当接到开发任务时，请按以下结构进行分析：
1. 需求理解与分析
2. 功能模块划分
3. 技术选型建议
4. 实现优先级排序
5. 验收标准定义

请简洁明了地回应，并在分析完成后说"请工程师开始实现"。"""

    return AssistantAgent(
        name="ProductManager",
        model_client=model_client,
        system_message=system_message,
    )


def create_engineer(model_client, name="Engineer"):
    """创建软件工程师智能体"""
    system_message = f"""你是一位资深的软件工程师，擅长 Python 开发和 Web 应用构建。

你的技术专长包括：
1. **Python 编程**：熟练掌握 Python 语法和最佳实践
2. **Web 开发**：精通 Streamlit、Flask、Django 等框架
3. **API 集成**：有丰富的第三方 API 集成经验
4. **错误处理**：注重代码的健壮性和异常处理

当收到开发任务时，请：
1. 仔细分析技术需求
2. 选择合适的技术方案
3. 编写完整的代码实现
4. 添加必要的注释和说明
5. 考虑边界情况和异常处理

流程要求（必须遵守）：
1. 如果上一个发言者是产品经理（ProductManager），你在完成实现后必须在最后一行输出 `{HANDOFF_REVIEW}`。
2. 如果上一个发言者是代码审查员（CodeReviewer），你在完成修改后必须在最后一行输出 `{HANDOFF_QA}`。
3. 如果上一个发言者是测试工程师（QualityAssurance），你在完成修复后必须在最后一行输出 `{HANDOFF_USER}`。
4. 除上述标记外，不要输出其他 HANDOFF 标记。

请提供完整的可运行代码，最后一行按流程输出 HANDOFF 标记。"""

    return AssistantAgent(
        name=name,
        model_client=model_client,
        system_message=system_message,
    )


def create_code_reviewer(model_client):
    """创建代码审查员智能体"""
    system_message = """你是一位经验丰富的代码审查专家，专注于代码质量和最佳实践。

你的审查重点包括：
1. **代码质量**：检查代码的可读性、可维护性和性能
2. **安全性**：识别潜在的安全漏洞和风险点
3. **最佳实践**：确保代码遵循行业标准和最佳实践
4. **错误处理**：验证异常处理的完整性和合理性

审查流程：
1. 仔细阅读和理解代码逻辑
2. 检查代码规范和最佳实践
3. 识别潜在问题和改进点
4. 提供具体的修改建议
5. 评估代码的整体质量

请提供具体的审查意见，最后一行输出 HANDOFF:ENGINEER。"""

    return AssistantAgent(
        name="CodeReviewer",
        model_client=model_client,
        system_message=system_message,
    )


def create_qa_engineer(model_client):
    """创建测试工程师智能体"""
    system_message = """你是一位资深的测试工程师（Quality Assurance），负责在代码审查之后执行自动化测试和质量验证。

你的审查与测试重点包括：
1. **测试策略**：根据需求选择合适的测试类型（单元、集成、E2E）
2. **自动化测试**：给出可执行的测试步骤或脚本（如 pytest、Playwright）
3. **风险验证**：覆盖关键路径、异常处理、边界场景
4. **结果汇报**：输出测试结论与需要修复的问题

测试流程：
1. 接收代码审查完成的上下文
2. 制定测试清单与执行步骤
3. 运行或指导运行自动化测试
4. 汇总测试结果与改进建议

请在测试完成后输出测试结论与问题列表，最后一行输出 HANDOFF:ENGINEER。"""

    return AssistantAgent(
        name="QualityAssurance",
        model_client=model_client,
        system_message=system_message,
    )


def create_user_proxy(input_func=None):
    """创建用户代理智能体"""
    return UserProxyAgent(
        name="UserProxy",
        description="""用户代理，负责以下职责：
1. 代表用户提出开发需求
2. 执行最终的代码实现
3. 验证功能是否符合预期
4. 提供用户反馈和建议

完成测试后请回复 TERMINATE。""",
        input_func=input_func,
    )

def create_release_manager(model_client):
    """创建交付收尾智能体"""
    system_message = """你负责在流程结束时发出终止信号。

如果收到任何消息，只回复：TERMINATE
不要输出其他内容。"""

    return AssistantAgent(
        name="ReleaseManager",
        model_client=model_client,
        system_message=system_message,
    )

def _build_user_input_func(user_input):
    consumed = False

    def _input(_prompt):
        nonlocal consumed
        if user_input is None or consumed:
            return INPUT_REQUIRED_TOKEN
        consumed = True
        return user_input

    return _input


def _should_terminate(messages):
    for message in messages:
        try:
            text = message.to_text()
        except Exception:
            continue
        if INPUT_REQUIRED_TOKEN in text and getattr(message, "source", "") == "UserProxy":
            return True
        if "TERMINATE" in text:
            return True
    return False

def _strip_control_lines(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if line.strip().startswith("HANDOFF:"):
            continue
        lines.append(line)
    return "\n".join(lines).strip()

def _has_input_required_token(message):
    try:
        text = message.to_text()
    except Exception:
        return False
    return INPUT_REQUIRED_TOKEN in text


async def _try_load_state(team_chat, state) -> bool:
    if state is None:
        return False
    try:
        await team_chat.load_state(state)
        return True
    except ValueError as exc:
        message = str(exc)
        if "Agent state for" in message and "not found in the saved state" in message:
            return False
        raise


def build_team(model_client, max_turns=20, user_input_func=None):
    product_manager = create_product_manager(model_client)
    engineer = create_engineer(model_client, name="Engineer")
    code_reviewer = create_code_reviewer(model_client)
    qa_engineer = create_qa_engineer(model_client)
    user_proxy = create_user_proxy(input_func=user_input_func)
    release_manager = create_release_manager(model_client)

    builder = DiGraphBuilder()
    (
        builder.add_node(product_manager)
        .add_node(engineer)
        .add_node(code_reviewer)
        .add_node(qa_engineer)
        .add_node(user_proxy)
        .add_node(release_manager)
    )

    builder.add_edge(product_manager, engineer, activation_condition="any")
    builder.add_edge(engineer, code_reviewer, condition=HANDOFF_REVIEW)
    builder.add_edge(engineer, qa_engineer, condition=HANDOFF_QA)
    builder.add_edge(engineer, user_proxy, condition=HANDOFF_USER)
    builder.add_edge(code_reviewer, engineer, condition=HANDOFF_ENGINEER, activation_condition="any")
    builder.add_edge(qa_engineer, engineer, condition=HANDOFF_ENGINEER, activation_condition="any")
    builder.add_edge(user_proxy, user_proxy, condition=_has_input_required_token)
    builder.add_edge(
        user_proxy,
        release_manager,
        condition=lambda msg: not _has_input_required_token(msg),
    )
    builder.set_entry_point(product_manager)

    return GraphFlow(
        participants=builder.get_participants(),
        graph=builder.build(),
        termination_condition=FunctionalTermination(_should_terminate),
        max_turns=max_turns,
    )


async def run_software_development_team(
    task=None,
    max_turns=20,
    stream_to_console=True,
    state=None,
    user_input=None,
):
    model_client = create_openai_model_client()
    user_input_func = None if stream_to_console else _build_user_input_func(user_input)
    team_chat = build_team(model_client, max_turns=max_turns, user_input_func=user_input_func)

    task_to_run = task
    if state is not None:
        if await _try_load_state(team_chat, state):
            task_to_run = None
    elif task is None:
        task_to_run = DEFAULT_TASK

    if stream_to_console:
        # 异步执行团队协作，并流式输出对话过程
        await Console(team_chat.run_stream(task=task_to_run))
        return None, None, False

    result = await team_chat.run(task=task_to_run)
    input_required = _has_input_required(result.messages)
    saved_state = None
    if input_required:
        saved_state = await team_chat.save_state()
        saved_state = _strip_input_required_from_state(saved_state)
    return result, saved_state, input_required


def _message_to_text(message) -> str:
    try:
        text = message.to_text()
    except Exception:
        return ""
    return _strip_control_lines(str(text))


def _message_to_transcript_text(message) -> str:
    text = _message_to_text(message)
    if text:
        return text
    content = getattr(message, "content", None)
    if isinstance(content, str):
        stripped = _strip_control_lines(content).strip()
        if stripped:
            return stripped
    if isinstance(content, list):
        parts = [str(item) for item in content if isinstance(item, str) and item.strip()]
        if parts:
            return _strip_control_lines("\n".join(parts)).strip()
    try:
        model_text = message.to_model_text()
    except Exception:
        return ""
    return _strip_control_lines(str(model_text)).strip()


def _message_to_transcript_item(message):
    if not isinstance(message, BaseChatMessage):
        return None
    text = _message_to_transcript_text(message)
    if not text:
        _debug_log(f"Transcript empty for {type(message).__name__} source={getattr(message, 'source', '')!r}")
        return None
    if INPUT_REQUIRED_TOKEN in text:
        return None
    if text.strip() == "TERMINATE":
        return None
    source = getattr(message, "source", "event")
    if source in {"UserProxy", "user"}:
        return None
    return {"source": source, "content": text}


def _extract_answer(messages) -> str:
    for message in reversed(messages):
        if not isinstance(message, BaseChatMessage):
            continue
        text = _message_to_text(message)
        if not text:
            continue
        if INPUT_REQUIRED_TOKEN in text:
            continue
        if "TERMINATE" in text:
            continue
        if getattr(message, "source", "") == "UserProxy":
            continue
        return text

    for message in reversed(messages):
        text = _message_to_text(message)
        if text and "TERMINATE" not in text:
            return text

    return ""


def _extract_transcript(messages):
    transcript = []
    for message in messages:
        item = _message_to_transcript_item(message)
        if item:
            transcript.append(item)
    return transcript


def _format_transcript_item_lines(item: dict, index: int) -> list[str]:
    source = item.get("source", "Unknown")
    content = str(item.get("content", "")).strip()
    lines = [f"{source}："]
    if not content:
        return lines
    if _looks_like_code(content):
        lines.extend(_wrap_code_block(content).splitlines())
        return lines
    for line in content.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if re.match(r"^[-*]\s+", cleaned) or re.match(r"^\d+[.)、]\s+", cleaned):
            lines.append(cleaned)
        else:
            lines.append(f"- {cleaned}")
    return lines


def _format_transcript_for_answer(messages) -> str:
    transcript: list[dict] = []
    for message in messages:
        item = _message_to_transcript_item(message)
        if item:
            transcript.append(item)
    if not transcript:
        return ""
    lines = ["团队协作过程："]
    for index, item in enumerate(transcript, start=1):
        if index > 1:
            lines.append("")
        lines.extend(_format_transcript_item_lines(item, index))
    return "\n".join(lines)


def _build_answer(messages) -> str:
    transcript_text = _format_transcript_for_answer(messages)
    if transcript_text:
        return transcript_text
    answer = _extract_answer(messages)
    if _looks_like_code(answer):
        answer = _wrap_code_block(answer)
    return answer

async def run_software_development_team_stream(
    task=None,
    max_turns=20,
    state=None,
    user_input=None,
    include_trace=False,
    include_transcript=False,
    include_stream_deltas=True,
):
    model_client = create_openai_model_client()
    user_input_func = _build_user_input_func(user_input)
    team_chat = build_team(model_client, max_turns=max_turns, user_input_func=user_input_func)

    task_to_run = task
    if state is not None:
        if await _try_load_state(team_chat, state):
            task_to_run = None
    elif task is None:
        task_to_run = DEFAULT_TASK

    messages = []
    final_result = None
    stream_started = False
    transcript_index = 0
    streamed = False
    streamed_keys: set[tuple[str, str]] = set()
    async for message in team_chat.run_stream(task=task_to_run):
        _debug_log(f"Stream event type={type(message).__name__}")
        if isinstance(message, BaseChatMessage):
            messages.append(message)
            _debug_log(
                f"ChatMessage source={getattr(message, 'source', '')!r} text_len={len(_message_to_transcript_text(message))}"
            )
            item = _message_to_transcript_item(message)
            if item and include_transcript:
                print(json.dumps({"type": "transcript", **item}, ensure_ascii=False), flush=True)
            if item and include_stream_deltas:
                key = (item.get("source", ""), item.get("content", ""))
                if key in streamed_keys:
                    continue
                if not stream_started:
                    print(json.dumps({"type": "delta", "delta": "团队协作过程：\n"}, ensure_ascii=False), flush=True)
                    stream_started = True
                prefix = "\n" if transcript_index > 0 else ""
                transcript_index += 1
                chunk = prefix + "\n".join(_format_transcript_item_lines(item, transcript_index)) + "\n"
                print(json.dumps({"type": "delta", "delta": chunk}, ensure_ascii=False), flush=True)
                streamed_keys.add(key)
                streamed = True
        elif isinstance(message, TaskResult):
            final_result = message
            _debug_log(f"TaskResult messages={len(getattr(final_result, 'messages', []) or [])}")

    if final_result and getattr(final_result, "messages", None):
        messages = list(final_result.messages)
        _debug_log(f"Final messages count={len(messages)}")
        if include_stream_deltas:
            for item in _extract_transcript(messages):
                key = (item.get("source", ""), item.get("content", ""))
                if key in streamed_keys:
                    continue
                if not stream_started:
                    print(
                        json.dumps({"type": "delta", "delta": "团队协作过程：\n"}, ensure_ascii=False),
                        flush=True,
                    )
                    stream_started = True
                prefix = "\n" if transcript_index > 0 else ""
                transcript_index += 1
                chunk = prefix + "\n".join(_format_transcript_item_lines(item, transcript_index)) + "\n"
                print(json.dumps({"type": "delta", "delta": chunk}, ensure_ascii=False), flush=True)
                streamed_keys.add(key)
                streamed = True

    input_required = _has_input_required(messages)
    saved_state = None
    if input_required:
        saved_state = await team_chat.save_state()
        saved_state = _strip_input_required_from_state(saved_state)

    answer = _build_answer(messages)
    status = "input_required" if input_required else "completed"
    payload = {
        "type": "final",
        "status": status,
        "answer": answer or "未获取到有效输出。",
        "streamed": streamed,
    }
    if input_required:
        payload["state"] = saved_state or {}
    if include_trace:
        payload["trace"] = _format_trace(messages)
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _format_trace(messages) -> str:
    lines = []
    for message in messages:
        text = _message_to_text(message)
        if not text:
            continue
        if INPUT_REQUIRED_TOKEN in text:
            continue
        source = getattr(message, "source", "event")
        lines.append(f"[{source}] {text}")
    return "\n".join(lines)


def _has_input_required(messages) -> bool:
    for message in messages:
        if not isinstance(message, BaseChatMessage):
            continue
        if getattr(message, "source", "") != "UserProxy":
            continue
        text = _message_to_text(message)
        if INPUT_REQUIRED_TOKEN in text:
            return True
    return False


def _strip_input_required_from_state(state):
    if isinstance(state, list):
        cleaned_list = []
        for item in state:
            cleaned = _strip_input_required_from_state(item)
            if cleaned is None:
                continue
            cleaned_list.append(cleaned)
        return cleaned_list
    if isinstance(state, dict):
        content = state.get("content")
        source = state.get("source")
        if isinstance(content, str) and source == "UserProxy" and INPUT_REQUIRED_TOKEN in content:
            return None
        cleaned_dict = {}
        for key, value in state.items():
            cleaned_dict[key] = _strip_input_required_from_state(value)
        return cleaned_dict
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, default=None)
    parser.add_argument("--max-turns", type=int, default=20)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--transcript", action="store_true")
    parser.add_argument("--stream-delta", action="store_true")
    args = parser.parse_args()

    prompt = args.prompt
    include_trace = args.trace
    include_transcript = args.transcript
    include_stream_deltas = True
    state = None
    user_input = None
    stream_json = False
    env_transcript = os.environ.get("HELLOAGENT_TRANSCRIPT")
    env_stream_delta = os.environ.get("HELLOAGENT_STREAM_DELTA")
    if args.json:
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict):
            prompt = payload.get("prompt") or prompt
            state = payload.get("state")
            user_input = payload.get("user_input")
            stream_json = bool(payload.get("stream"))
            if payload.get("trace") is not None:
                include_trace = bool(payload.get("trace"))
            if payload.get("transcript") is not None:
                include_transcript = bool(payload.get("transcript"))
            if payload.get("stream_delta") is not None:
                include_stream_deltas = bool(payload.get("stream_delta"))
    if args.stream_delta:
        include_stream_deltas = True
    if env_stream_delta is not None:
        include_stream_deltas = env_stream_delta == "1"

    if not prompt and state is None:
        prompt = DEFAULT_TASK

    if args.json and stream_json:
        if state is not None and user_input is None:
            user_input = prompt
        if env_transcript is not None:
            include_transcript = env_transcript == "1"
        asyncio.run(
            run_software_development_team_stream(
                task=prompt,
                max_turns=args.max_turns,
                state=state,
                user_input=user_input,
                include_trace=include_trace,
                include_transcript=include_transcript,
                include_stream_deltas=include_stream_deltas,
            )
        )
        return 0

    if args.json:
        if state is not None and user_input is None:
            user_input = prompt
        result, saved_state, input_required = asyncio.run(
            run_software_development_team(
                task=prompt,
                max_turns=args.max_turns,
                stream_to_console=False,
                state=state,
                user_input=user_input,
            )
        )
        answer = _build_answer(result.messages) if result else ""
        status = "input_required" if input_required else "completed"
        payload = {"status": status, "answer": answer or "未获取到有效输出。"}
        if result:
            payload["transcript"] = _extract_transcript(result.messages)
        if input_required:
            payload["state"] = saved_state or {}
        if include_trace:
            payload["trace"] = _format_trace(result.messages) if result else ""
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    asyncio.run(
        run_software_development_team(
            task=prompt,
            max_turns=args.max_turns,
            stream_to_console=True,
        )
    )

    return 0

# 主程序入口
if __name__ == "__main__":
    raise SystemExit(main())
