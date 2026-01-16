import { useEffect, useRef, useState } from "react";

type StatusState = "idle" | "running" | "succeeded" | "failed";

const POLL_INTERVAL_MS = 1500;

const clampProgress = (value: number) => Math.min(100, Math.max(0, value));

const getFailureMessage = (reason: string, error: string) => {
  if (reason === "input_moderation") {
    return "输入内容可能涉及违规，请调整提示词或参考图。";
  }
  if (reason === "output_moderation") {
    return "生成内容未通过审核，请修改提示词后重试。";
  }
  if (error) {
    return `生成失败：${error}`;
  }
  return "生成失败，请稍后重试。";
};

export function useJobPoll() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<StatusState>("idle");
  const [taskId, setTaskId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const resetJob = () => {
    stopPolling();
    setStatus("idle");
    setProgress(0);
    setTaskId("");
    setErrorMessage("");
  };

  const startPolling = async (id: string, onJobComplete?: (data: any) => void) => {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
      }
      const payload = await response.json();

      if (typeof payload.progress === "number") {
        setProgress(clampProgress(Math.round(payload.progress)));
      }

      if (typeof payload.status === "string") {
        if (payload.status === "running" || payload.status === "submitted") {
          setStatus("running");
          pollRef.current = window.setTimeout(
            () => void startPolling(id, onJobComplete),
            POLL_INTERVAL_MS
          );
        } else if (payload.status === "succeeded") {
          setStatus("succeeded");
          stopPolling();
          onJobComplete?.(payload);
        } else if (payload.status === "failed") {
          setStatus("failed");
          stopPolling();
        }
      }

      const failureReason = typeof payload.failure_reason === "string" ? payload.failure_reason : "";
      const errorDetail = typeof payload.error === "string" ? payload.error : "";
      if (failureReason || errorDetail) {
        setErrorMessage(getFailureMessage(failureReason, errorDetail));
        if (payload.status === "failed") {
          setStatus("failed");
          stopPolling();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
      setErrorMessage(message);
      setStatus("failed");
      stopPolling();
    }
  };

  return {
    progress,
    status,
    taskId,
    errorMessage,
    setProgress,
    setStatus,
    setTaskId,
    setErrorMessage,
    resetJob,
    startPolling,
    stopPolling,
  };
}
