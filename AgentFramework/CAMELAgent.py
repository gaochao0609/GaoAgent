from pathlib import Path
from typing import List, Optional, Union
from colorama import Fore

from camel.agents.chat_agent import FunctionCallingRecord
from camel.configs import ChatGPTConfig
from camel.toolkits import (
    MathToolkit,
    RetrievalToolkit,
)
from camel.societies import RolePlaying
from camel.types import ModelType, ModelPlatformType
from camel.utils import print_text_animated
from camel.models import ModelFactory

def role_playing_with_rag(
    task_prompt,
    model_platform=ModelPlatformType.OPENAI,
    model_type=ModelType.GPT_4O,
    chat_turn_limit=5,
    rag_sources: Optional[Union[str, List[str]]] = None,
    rag_query: Optional[str] = None,
    similarity_threshold: Optional[float] = None,
    top_k: Optional[int] = None,
    force_retrieval: bool = True,
) -> None:
    task_prompt = task_prompt

    if force_retrieval:
        if not rag_sources:
            raise ValueError(
                "rag_sources must be set when force_retrieval is True."
            )
        query = rag_query or task_prompt
        retrieval_kwargs = {}
        if top_k is not None:
            retrieval_kwargs["top_k"] = top_k
        if similarity_threshold is not None:
            retrieval_kwargs["similarity_threshold"] = similarity_threshold

        rag_context = RetrievalToolkit().information_retrieval(
            query=query,
            contents=rag_sources,
            **retrieval_kwargs,
        )
        task_prompt = (
            f"{task_prompt}\n\nRetrieved context:\n{rag_context}"
        )

    tools_list = [
        *MathToolkit().get_tools(),
        *RetrievalToolkit().get_tools(),
    ]


    role_play_session = RolePlaying(
        assistant_role_name="Searcher",
        user_role_name="Professor",
        assistant_agent_kwargs=dict(
            model=ModelFactory.create(
                model_platform=model_platform,
                model_type=model_type,
            ),
            tools=tools_list,
        ),
        user_agent_kwargs=dict(
            model=ModelFactory.create(
                model_platform=model_platform,
                model_type=model_type,
            ),
        ),
        task_prompt=task_prompt,
        with_task_specify=False,
    )

    print(
        Fore.GREEN
        + f"AI Assistant sys message:\n{role_play_session.assistant_sys_msg}\n"
    )
    print(
        Fore.BLUE + f"AI User sys message:\n{role_play_session.user_sys_msg}\n"
    )

    print(Fore.YELLOW + f"Original task prompt:\n{task_prompt}\n")
    print(
        Fore.CYAN
        + "Specified task prompt:"
        + f"\n{role_play_session.specified_task_prompt}\n"
    )
    print(Fore.RED + f"Final task prompt:\n{role_play_session.task_prompt}\n")

    n = 0
    input_msg = role_play_session.init_chat()
    while n < chat_turn_limit:
        n += 1
        assistant_response, user_response = role_play_session.step(input_msg)

        if assistant_response.terminated:
            print(
                Fore.GREEN
                + (
                    "AI Assistant terminated. Reason: "
                    f"{assistant_response.info['termination_reasons']}."
                )
            )
            break
        if user_response.terminated:
            print(
                Fore.GREEN
                + (
                    "AI User terminated. "
                    f"Reason: {user_response.info['termination_reasons']}."
                )
            )
            break

        # Print output from the user
        print_text_animated(
            Fore.BLUE + f"AI User:\n\n{user_response.msg.content}\n"
        )

        # Print output from the assistant, including any function
        # execution information
        print_text_animated(Fore.GREEN + "AI Assistant:")
        tool_calls: List[FunctionCallingRecord] = [
            FunctionCallingRecord(**call.as_dict())
            for call in assistant_response.info['tool_calls']
        ]
        for func_record in tool_calls:
            print_text_animated(f"{func_record}")
        print_text_animated(f"{assistant_response.msg.content}\n")

        if "CAMEL_TASK_DONE" in user_response.msg.content:
            break

        input_msg = assistant_response.msg

role_playing_with_rag(task_prompt = 
                      """
                      If I'm interest in contributing to the CAMEL projec and I encounter some challenges during the setup process, what should I do? 
                      You should refer to the content in url https://github.com/camel-ai/camel/wiki/Contributing-Guidlines to answer my question, 
                      don't generate the answer by yourself, adjust the similarity threshold to lower value is necessary
                      """,
                      rag_sources=[
                          str(Path(__file__).with_name("Dify_README.md")),
                          "https://github.com/camel-ai/camel/wiki/Contributing-Guidlines",
                      ],
                      similarity_threshold=0.2,
                      )
