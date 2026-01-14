from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from tavily import TavilyClient
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver
import asyncio


# 加载 .env 文件中的环境变量
load_dotenv()

# 初始化模型
# 我们将使用这个 llm 实例来驱动所有节点的智能
llm = ChatOpenAI(
    model=os.getenv("LLM_MODEL_ID", "gpt-5-mini"),
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
)
# 初始化Tavily客户端
tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))


class SearchState(TypedDict):
    messages: Annotated[list, add_messages]
    user_query: str      # 经过LLM理解后的用户需求总结
    search_query: str    # 优化后用于Tavily API的搜索查询
    search_results: str  # Tavily搜索返回的结果
    final_answer: str    # 最终生成的答案
    step: str            # 标记当前步骤
    reflection_rounds: int      # 反思/重试次数
    max_reflection_rounds: int  # 最大反思/重试次数
    low_quality: bool           # 回答质量是否低
    should_retry: bool          # 是否需要重试
    retry_action: str           # 重试方向: "search" 或 "answer"


def understand_query_node(state: SearchState) -> dict:
    """步骤1：理解用户查询并生成搜索关键词"""
    user_message = state["messages"][-1].content
    
    understand_prompt = f"""分析用户的查询："{user_message}"
请完成两个任务：
1. 简洁总结用户想要了解什么
2. 生成最适合搜索引擎的关键词（中英文均可，要精准）

格式：
理解：[用户需求总结]
搜索词：[最佳搜索关键词]"""

    response = llm.invoke([SystemMessage(content=understand_prompt)])
    response_text = response.content
    
    # 解析LLM的输出，提取搜索关键词
    search_query = user_message # 默认使用原始查询
    if "搜索词：" in response_text:
        search_query = response_text.split("搜索词：")[1].strip()
    
    return {
        "user_query": response_text,
        "search_query": search_query,
        "step": "understood",
        "messages": [AIMessage(content=f"我将为您搜索：{search_query}")]
    }


def tavily_search_node(state: SearchState) -> dict:
    """步骤2：使用Tavily API进行真实搜索"""
    search_query = state["search_query"]
    try:
        print(f"🔍 正在搜索: {search_query}")
        response = tavily_client.search(
            query=search_query, search_depth="basic", max_results=5, include_answer=True
        )
        # Normalize and format the response for downstream prompts.
        if not isinstance(response, dict):
            raise ValueError("Unexpected response type from Tavily")

        answer = response.get("answer", "")
        results = response.get("results") or response.get("data") or []

        lines = []
        if answer:
            lines.append(f"Answer: {answer}")

        for idx, item in enumerate(results, start=1):
            if not isinstance(item, dict):
                continue
            title = item.get("title") or item.get("name") or "Untitled"
            url = item.get("url") or item.get("link") or ""
            content = item.get("content") or item.get("snippet") or ""

            lines.append(f"{idx}. {title}")
            if url:
                lines.append(f"   {url}")
            if content:
                lines.append(f"   {content}")

        search_results = "\n".join(lines).strip()
        if not search_results:
            search_results = "No results returned from Tavily."
        
        return {
            "search_results": search_results,
            "step": "searched",
            "messages": [AIMessage(content="✅ 搜索完成！正在整理答案...")]
        }
    except Exception as e:
        # ... (处理错误) ...
        return {
            "search_results": f"搜索失败：{e}",
            "step": "search_failed",
            "messages": [AIMessage(content="❌ 搜索遇到问题...")]
        }
    
def generate_answer_node(state: SearchState) -> dict:
    """步骤3：基于搜索结果生成最终答案"""
    if state["step"] == "search_failed":
        # 如果搜索失败，执行回退策略，基于LLM自身知识回答
        fallback_prompt = f"搜索API暂时不可用，请基于您的知识回答用户的问题：\n用户问题：{state['user_query']}"
        response = llm.invoke([SystemMessage(content=fallback_prompt)])
    else:
        # 搜索成功，基于搜索结果生成答案
        answer_prompt = f"""基于以下搜索结果为用户提供完整、准确的答案：
用户问题：{state['user_query']}
搜索结果：\n{state['search_results']}
请综合搜索结果，提供准确、有用的回答..."""
        response = llm.invoke([SystemMessage(content=answer_prompt)])
    
    return {
        "final_answer": response.content,
        "step": "completed",
        "messages": [AIMessage(content=response.content)]
    }

def reflect_answer_node(state: SearchState) -> dict:
    """反思：如果回答过短或缺乏细节，触发重试"""
    answer = (state.get("final_answer") or "").strip()
    rounds = state.get("reflection_rounds", 0)
    max_rounds = state.get("max_reflection_rounds", 1)

    sentence_marks = "。！？!?"
    sentence_count = sum(answer.count(ch) for ch in sentence_marks)
    low_quality = len(answer) < 120 or sentence_count < 2
    should_retry = low_quality and rounds < max_rounds

    retry_action = "answer"
    search_results = (state.get("search_results") or "").strip()
    if should_retry:
        if not search_results or "搜索失败" in search_results or "No results returned" in search_results:
            retry_action = "search"

    if should_retry:
        message = "反思：回答过短或信息不足，准备重试。"
    elif low_quality:
        message = "反思：回答质量偏低，但已达到最大重试次数。"
    else:
        message = "反思：回答质量可接受。"

    return {
        "step": "reflected",
        "reflection_rounds": rounds + 1 if should_retry else rounds,
        "max_reflection_rounds": max_rounds,
        "low_quality": low_quality,
        "should_retry": should_retry,
        "retry_action": retry_action,
        "messages": [AIMessage(content=message)],
    }

def reflection_router(state: SearchState):
    if not state.get("should_retry"):
        return END
    return state.get("retry_action", "answer")

def create_search_assistant():
    workflow = StateGraph(SearchState)
    
    # 添加节点
    workflow.add_node("understand", understand_query_node)
    workflow.add_node("search", tavily_search_node)
    workflow.add_node("answer", generate_answer_node)
    workflow.add_node("reflect", reflect_answer_node)
    
    # 设置线性流程
    workflow.add_edge(START, "understand")
    workflow.add_edge("understand", "search")
    workflow.add_edge("search", "answer")
    workflow.add_edge("answer", "reflect")
    workflow.add_conditional_edges("reflect", reflection_router, {"search": "search", "answer": "answer", END: END})
    
    # 编译图
    memory = InMemorySaver()
    app = workflow.compile(checkpointer=memory)
    return app


async def main():
    """主函数：运行智能搜索助手"""
    
    # 检查API密钥
    if not os.getenv("TAVILY_API_KEY"):
        print("❌ 错误：请在.env文件中配置TAVILY_API_KEY")
        return
    
    app = create_search_assistant()
    
    print("🔍 智能搜索助手启动！")
    print("我会使用Tavily API为您搜索最新、最准确的信息")
    print("支持各种问题：新闻、技术、知识问答等")
    print("(输入 'quit' 退出)\n")
    
    session_count = 0
    
    while True:
        user_input = input("🤔 您想了解什么: ").strip()
        
        if user_input.lower() in ['quit', 'q', '退出', 'exit']:
            print("感谢使用！再见！👋")
            break
        
        if not user_input:
            continue
        
        session_count += 1
        config = {"configurable": {"thread_id": f"search-session-{session_count}"}}
        
        # 初始状态
        initial_state = {
            "messages": [HumanMessage(content=user_input)],
            "user_query": "",
            "search_query": "",
            "search_results": "",
            "final_answer": "",
            "step": "start",
            "reflection_rounds": 0,
            "max_reflection_rounds": 1,
            "low_quality": False,
            "should_retry": False,
            "retry_action": "answer",
        }
        
        try:
            print("\n" + "="*60)
            
            # 执行工作流
            async for output in app.astream(initial_state, config=config):
                for node_name, node_output in output.items():
                    if "messages" in node_output and node_output["messages"]:
                        latest_message = node_output["messages"][-1]
                        if isinstance(latest_message, AIMessage):
                            if node_name == "understand":
                                print(f"🧠 理解阶段: {latest_message.content}")
                            elif node_name == "search":
                                print(f"🔍 搜索阶段: {latest_message.content}")
                            elif node_name == "answer":
                                print(f"\n💡 最终回答:\n{latest_message.content}")
                            elif node_name == "reflect":
                                print(f"🧩 反思阶段: {latest_message.content}")
            
            print("\n" + "="*60 + "\n")
        
        except Exception as e:
            print(f"❌ 发生错误: {e}")
            print("请重新输入您的问题。\n")

if __name__ == "__main__":
    asyncio.run(main())
