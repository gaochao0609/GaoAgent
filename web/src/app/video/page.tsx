"use client";

import { type ChangeEvent, type CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";

type StatusState = "idle" | "running" | "succeeded" | "failed";

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
};

const formatSeconds = (value: number | null) =>
  value === null || Number.isNaN(value) ? "--" : value.toFixed(2);

const clampProgress = (value: number) => Math.min(100, Math.max(0, value));
const POLL_INTERVAL_MS = 1500;

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

const parseStreamLine = (line: string) => {
  if (!line.trim()) {
    return null;
  }
  const cleaned = line.replace(/^data:\s*/i, "").trim();
  if (!cleaned) {
    return null;
  }
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const revokeObjectUrl = (url: string | null) => {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

export default function VideoPage() {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [prompt, setPrompt] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [duration, setDuration] = useState("15");
  const [size, setSize] = useState("small");
  const [remixTargetId, setRemixTargetId] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<StatusState>("idle");
  const [taskId, setTaskId] = useState("");
  const [pid, setPid] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<number | null>(null);
  const downloadName = selectedImage
    ? `generated-${selectedImage.name}`
    : "generated-video.mp4";
  const [characterVideo, setCharacterVideo] = useState<File | null>(null);
  const [characterPreviewUrl, setCharacterPreviewUrl] = useState<string | null>(null);
  const [characterIsDragging, setCharacterIsDragging] = useState(false);
  const [characterStart, setCharacterStart] = useState<number | null>(null);
  const [characterEnd, setCharacterEnd] = useState<number | null>(null);
  const [characterDuration, setCharacterDuration] = useState<number | null>(null);
  const [characterProgress, setCharacterProgress] = useState(0);
  const [characterStatus, setCharacterStatus] = useState<StatusState>("idle");
  const [characterTaskId, setCharacterTaskId] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [characterError, setCharacterError] = useState("");
  const [characterIsSubmitting, setCharacterIsSubmitting] = useState(false);
  const [characterCopied, setCharacterCopied] = useState(false);
  const [characterClipOpen, setCharacterClipOpen] = useState(false);
  const characterInputRef = useRef<HTMLInputElement | null>(null);
  const characterVideoRef = useRef<HTMLVideoElement | null>(null);
  const characterAbortRef = useRef<AbortController | null>(null);
  const [pidClipOpen, setPidClipOpen] = useState(false);
  const [pidStart, setPidStart] = useState<number | null>(null);
  const [pidEnd, setPidEnd] = useState<number | null>(null);
  const [pidDuration, setPidDuration] = useState<number | null>(null);
  const [pidProgress, setPidProgress] = useState(0);
  const [pidStatus, setPidStatus] = useState<StatusState>("idle");
  const [pidTaskId, setPidTaskId] = useState("");
  const [pidCharacterId, setPidCharacterId] = useState("");
  const [pidError, setPidError] = useState("");
  const [pidIsSubmitting, setPidIsSubmitting] = useState(false);
  const [pidCopied, setPidCopied] = useState(false);
  const resultVideoRef = useRef<HTMLVideoElement | null>(null);
  const pidAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      revokeObjectUrl(previewUrl);
      revokeObjectUrl(resultUrl);
      revokeObjectUrl(characterPreviewUrl);
    };
  }, [previewUrl, resultUrl, characterPreviewUrl]);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    setStatus("idle");
    setProgress(0);
    setTaskId("");
    setPid("");
    setErrorMessage("");
    setResultUrl(null);
    if (mode === "text") {
      setSelectedImage(null);
      setPreviewUrl(null);
    }
  }, [mode]);

  useEffect(() => {
    if (!characterCopied) {
      return;
    }
    const timer = window.setTimeout(() => setCharacterCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [characterCopied]);

  useEffect(() => {
    if (!pidCopied) {
      return;
    }
    const timer = window.setTimeout(() => setPidCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [pidCopied]);

  const resetOutput = () => {
    if (isSubmitting) {
      return;
    }
    stopPolling();
    setStatus("idle");
    setProgress(0);
    setTaskId("");
    setPid("");
    setErrorMessage("");
    setResultUrl(null);
  };

  const resetCharacterOutput = () => {
    if (characterIsSubmitting) {
      return;
    }
    setCharacterStatus("idle");
    setCharacterProgress(0);
    setCharacterTaskId("");
    setCharacterId("");
    setCharacterError("");
    setCharacterCopied(false);
  };

  const resetPidOutput = () => {
    if (pidIsSubmitting) {
      return;
    }
    setPidStatus("idle");
    setPidProgress(0);
    setPidTaskId("");
    setPidCharacterId("");
    setPidError("");
    setPidCopied(false);
  };

  const resetPidSelection = () => {
    setPidStart(null);
    setPidEnd(null);
    setPidDuration(null);
    setPidClipOpen(false);
  };

  const resetCharacterSelection = () => {
    revokeObjectUrl(characterPreviewUrl);
    setCharacterVideo(null);
    setCharacterPreviewUrl(null);
    setCharacterStart(null);
    setCharacterEnd(null);
    setCharacterDuration(null);
    setCharacterClipOpen(false);
  };

  const handleCharacterFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setCharacterError("仅支持上传视频文件。");
      return;
    }
    resetCharacterOutput();
    resetCharacterSelection();
    const nextUrl = URL.createObjectURL(file);
    setCharacterVideo(file);
    setCharacterPreviewUrl(nextUrl);
    setCharacterClipOpen(false);
  };

  const handleCharacterInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleCharacterFile(file);
    }
    event.target.value = "";
  };

  const openCharacterPicker = () => {
    characterInputRef.current?.click();
  };

  const updateStart = (value: string) => {
    resetCharacterOutput();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setCharacterStart(null);
      return;
    }
    const maxSpan = characterDuration ? Math.min(3, characterDuration) : 3;
    const maxValue = characterDuration ?? Number.POSITIVE_INFINITY;
    const nextStart = Math.min(Math.max(parsed, 0), maxValue);
    let nextEnd = characterEnd ?? nextStart;
    if (nextEnd < nextStart) {
      nextEnd = nextStart;
    }
    if (nextEnd - nextStart > maxSpan) {
      nextEnd = Math.min(nextStart + maxSpan, maxValue);
    }
    setCharacterStart(Number(nextStart.toFixed(2)));
    setCharacterEnd(Number(nextEnd.toFixed(2)));
  };

  const updateEnd = (value: string) => {
    resetCharacterOutput();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setCharacterEnd(null);
      return;
    }
    const maxSpan = characterDuration ? Math.min(3, characterDuration) : 3;
    const maxValue = characterDuration ?? Number.POSITIVE_INFINITY;
    const nextEnd = Math.min(Math.max(parsed, 0), maxValue);
    let nextStart = characterStart ?? nextEnd;
    if (nextEnd < nextStart) {
      nextStart = nextEnd;
    }
    if (nextEnd - nextStart > maxSpan) {
      nextStart = Math.max(0, nextEnd - maxSpan);
    }
    setCharacterStart(Number(nextStart.toFixed(2)));
    setCharacterEnd(Number(nextEnd.toFixed(2)));
  };

  const updatePidStart = (value: string) => {
    resetPidOutput();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setPidStart(null);
      return;
    }
    const maxSpan = pidDuration ? Math.min(3, pidDuration) : 3;
    const maxValue = pidDuration ?? Number.POSITIVE_INFINITY;
    const nextStart = Math.min(Math.max(parsed, 0), maxValue);
    let nextEnd = pidEnd ?? nextStart;
    if (nextEnd < nextStart) {
      nextEnd = nextStart;
    }
    if (nextEnd - nextStart > maxSpan) {
      nextEnd = Math.min(nextStart + maxSpan, maxValue);
    }
    setPidStart(Number(nextStart.toFixed(2)));
    setPidEnd(Number(nextEnd.toFixed(2)));
  };

  const updatePidEnd = (value: string) => {
    resetPidOutput();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setPidEnd(null);
      return;
    }
    const maxSpan = pidDuration ? Math.min(3, pidDuration) : 3;
    const maxValue = pidDuration ?? Number.POSITIVE_INFINITY;
    const nextEnd = Math.min(Math.max(parsed, 0), maxValue);
    let nextStart = pidStart ?? nextEnd;
    if (nextEnd < nextStart) {
      nextStart = nextEnd;
    }
    if (nextEnd - nextStart > maxSpan) {
      nextStart = Math.max(0, nextEnd - maxSpan);
    }
    setPidStart(Number(nextStart.toFixed(2)));
    setPidEnd(Number(nextEnd.toFixed(2)));
  };

  const setPidStartFromVideo = () => {
    const current = resultVideoRef.current?.currentTime;
    if (current === undefined) {
      return;
    }
    updatePidStart(current.toFixed(2));
  };

  const setPidEndFromVideo = () => {
    const current = resultVideoRef.current?.currentTime;
    if (current === undefined) {
      return;
    }
    updatePidEnd(current.toFixed(2));
  };

  const setStartFromVideo = () => {
    const current = characterVideoRef.current?.currentTime;
    if (current === undefined) {
      return;
    }
    updateStart(current.toFixed(2));
  };

  const setEndFromVideo = () => {
    const current = characterVideoRef.current?.currentTime;
    if (current === undefined) {
      return;
    }
    updateEnd(current.toFixed(2));
  };

  const handleCharacterCancel = () => {
    characterAbortRef.current?.abort();
    characterAbortRef.current = null;
    setCharacterIsSubmitting(false);
    setCharacterStatus("idle");
    setCharacterProgress(0);
    setCharacterError("已取消上传。");
  };

  const copyCharacterId = async () => {
    if (!characterId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(characterId);
      setCharacterCopied(true);
    } catch {
      setCharacterError("复制失败，请手动复制角色 ID。");
    }
  };

  const copyPidCharacterId = async () => {
    if (!pidCharacterId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(pidCharacterId);
      setPidCopied(true);
    } catch {
      setPidError("复制失败，请手动复制角色 ID。");
    }
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMessage("仅支持上传图片作为参考图。");
      return;
    }
    resetOutput();
    revokeObjectUrl(previewUrl);
    const nextUrl = URL.createObjectURL(file);
    setSelectedImage(file);
    setPreviewUrl(nextUrl);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    event.target.value = "";
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopPolling();
    setIsSubmitting(false);
    setStatus("idle");
    setProgress(0);
    setErrorMessage("已取消生成。");
  };

  const applyVideoJobPayload = (payload: Record<string, unknown>) => {
    if (typeof payload.type === "string" && payload.type !== "video") {
      return;
    }
    if (typeof payload.id === "string") {
      setTaskId(payload.id);
    }
    if (typeof payload.progress === "number") {
      setProgress(clampProgress(Math.round(payload.progress)));
    }
    if (typeof payload.status === "string") {
      if (payload.status === "running" || payload.status === "submitted") {
        setStatus("running");
      } else if (payload.status === "succeeded") {
        setStatus("succeeded");
        setIsSubmitting(false);
        stopPolling();
      } else if (payload.status === "failed") {
        setStatus("failed");
        setIsSubmitting(false);
        stopPolling();
      }
    }

    const result = payload.result;
    if (result && typeof result === "object") {
      const record = result as { url?: unknown; pid?: unknown };
      if (typeof record.url === "string") {
        setResultUrl(record.url);
        setStatus("succeeded");
        setIsSubmitting(false);
        stopPolling();
      }
      if (typeof record.pid === "string") {
        setPid(record.pid);
      }
    }

    const failureReason =
      typeof payload.failure_reason === "string" ? payload.failure_reason : "";
    const errorDetail = typeof payload.error === "string" ? payload.error : "";
    if (failureReason || errorDetail) {
      setErrorMessage(getFailureMessage(failureReason, errorDetail));
      if (payload.status === "failed") {
        setStatus("failed");
        setIsSubmitting(false);
        stopPolling();
      }
    }
  };

  const pollVideoJob = async (id: string) => {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      applyVideoJobPayload(payload);
      if (payload.status === "running" || payload.status === "submitted") {
        pollRef.current = window.setTimeout(() => void pollVideoJob(id), POLL_INTERVAL_MS);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
      setErrorMessage(message);
      setStatus("failed");
      setIsSubmitting(false);
      stopPolling();
    }
  };

  const handleCharacterStreamPayload = (payload: Record<string, unknown>) => {
    if (
      typeof payload.code === "number" &&
      payload.code === 0 &&
      payload.data &&
      typeof (payload.data as { id?: unknown }).id === "string"
    ) {
      setCharacterTaskId((payload.data as { id: string }).id);
      setCharacterStatus("running");
      return;
    }

    if (typeof payload.id === "string") {
      setCharacterTaskId(payload.id);
    }
    if (typeof payload.progress === "number") {
      setCharacterProgress(clampProgress(Math.round(payload.progress)));
    }
    if (typeof payload.status === "string") {
      if (payload.status === "running") {
        setCharacterStatus("running");
      } else if (payload.status === "succeeded") {
        setCharacterStatus("succeeded");
      } else if (payload.status === "failed") {
        setCharacterStatus("failed");
      }
    }

    const results = payload.results;
    if (Array.isArray(results) && results.length > 0) {
      const first = results[0] as { character_id?: unknown };
      if (typeof first.character_id === "string") {
        setCharacterId(first.character_id);
        setCharacterStatus("succeeded");
      }
    }

    const failureReason =
      typeof payload.failure_reason === "string" ? payload.failure_reason : "";
    const errorDetail = typeof payload.error === "string" ? payload.error : "";
    if (failureReason || errorDetail) {
      setCharacterError(getFailureMessage(failureReason, errorDetail));
      if (payload.status === "failed") {
        setCharacterStatus("failed");
      }
    }
  };

  const handlePidStreamPayload = (payload: Record<string, unknown>) => {
    if (
      typeof payload.code === "number" &&
      payload.code === 0 &&
      payload.data &&
      typeof (payload.data as { id?: unknown }).id === "string"
    ) {
      setPidTaskId((payload.data as { id: string }).id);
      setPidStatus("running");
      return;
    }

    if (typeof payload.id === "string") {
      setPidTaskId(payload.id);
    }
    if (typeof payload.progress === "number") {
      setPidProgress(clampProgress(Math.round(payload.progress)));
    }
    if (typeof payload.status === "string") {
      if (payload.status === "running") {
        setPidStatus("running");
      } else if (payload.status === "succeeded") {
        setPidStatus("succeeded");
      } else if (payload.status === "failed") {
        setPidStatus("failed");
      }
    }

    const results = payload.results;
    if (Array.isArray(results) && results.length > 0) {
      const first = results[0] as { character_id?: unknown };
      if (typeof first.character_id === "string") {
        setPidCharacterId(first.character_id);
        setPidStatus("succeeded");
      }
    }

    const failureReason =
      typeof payload.failure_reason === "string" ? payload.failure_reason : "";
    const errorDetail = typeof payload.error === "string" ? payload.error : "";
    if (failureReason || errorDetail) {
      setPidError(getFailureMessage(failureReason, errorDetail));
      if (payload.status === "failed") {
        setPidStatus("failed");
      }
    }
  };

  const handleGenerate = async () => {
    if (isSubmitting) {
      return;
    }
    if (!prompt.trim()) {
      setErrorMessage("请输入提示词。");
      return;
    }
    if (mode === "image" && !selectedImage) {
      setErrorMessage("图生视频需要上传一张参考图。");
      return;
    }

    stopPolling();
    setIsSubmitting(true);
    setStatus("running");
    setProgress(0);
    setTaskId("");
    setPid("");
    setErrorMessage("");
    setResultUrl(null);
    resetPidSelection();
    resetPidOutput();
    setPidClipOpen(false);

    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("prompt", prompt.trim());
    formData.append("aspectRatio", aspectRatio);
    formData.append("duration", duration);
    formData.append("size", size);
    formData.append("remixTargetId", remixTargetId.trim());
    if (mode === "image" && selectedImage) {
      formData.append("image", selectedImage);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/video/sora", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `请求失败 (${response.status})`);
      }

      const payload = (await response.json()) as { request_id?: unknown };
      const requestId =
        typeof payload.request_id === "string" ? payload.request_id : "";
      if (!requestId) {
        throw new Error("后端未返回任务 ID");
      }
      setTaskId(requestId);
      setStatus("running");
      pollVideoJob(requestId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setErrorMessage("已取消生成。");
        setStatus("idle");
        setIsSubmitting(false);
        stopPolling();
      } else {
        const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
        setErrorMessage(message);
        setStatus("failed");
        setIsSubmitting(false);
        stopPolling();
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleCharacterGenerate = async () => {
    if (characterIsSubmitting) {
      return;
    }
    if (!characterVideo) {
      setCharacterError("请先上传视频文件。");
      return;
    }
    if (characterStart === null || characterEnd === null) {
      setCharacterError("请设置截取范围。");
      return;
    }
    const clipLength = characterEnd - characterStart;
    if (clipLength <= 0) {
      setCharacterError("结束时间需大于开始时间。");
      return;
    }
    if (clipLength > 3) {
      setCharacterError("截取范围不能超过 3 秒。");
      return;
    }

    setCharacterIsSubmitting(true);
    setCharacterStatus("running");
    setCharacterProgress(0);
    setCharacterTaskId("");
    setCharacterId("");
    setCharacterError("");

    const formData = new FormData();
    formData.append("video", characterVideo);
    formData.append("timestamps", `${characterStart.toFixed(2)},${characterEnd.toFixed(2)}`);
    const controller = new AbortController();
    characterAbortRef.current = controller;

    try {
      const response = await fetch("/api/video/character", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `请求失败 (${response.status})`);
      }

      if (!response.body) {
        const text = await response.text();
        const parsed = parseStreamLine(text);
        if (parsed) {
          handleCharacterStreamPayload(parsed);
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const payload = parseStreamLine(line);
          if (payload) {
            handleCharacterStreamPayload(payload);
          }
        }
      }

      const finalPayload = parseStreamLine(buffer);
      if (finalPayload) {
        handleCharacterStreamPayload(finalPayload);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setCharacterError("已取消上传。");
        setCharacterStatus("idle");
      } else {
        const message = error instanceof Error ? error.message : "上传失败，请稍后重试。";
        setCharacterError(message);
        setCharacterStatus("failed");
      }
    } finally {
      setCharacterIsSubmitting(false);
      characterAbortRef.current = null;
    }
  };

  const handlePidCharacterGenerate = async () => {
    if (pidIsSubmitting) {
      return;
    }
    if (!pid) {
      setPidError("当前视频未返回 pid，暂无法创建角色。");
      return;
    }
    if (pidStart === null || pidEnd === null) {
      setPidError("请设置截取范围。");
      return;
    }
    const clipLength = pidEnd - pidStart;
    if (clipLength <= 0) {
      setPidError("结束时间需大于开始时间。");
      return;
    }
    if (clipLength > 3) {
      setPidError("截取范围不能超过 3 秒。");
      return;
    }

    setPidIsSubmitting(true);
    setPidStatus("running");
    setPidProgress(0);
    setPidTaskId("");
    setPidCharacterId("");
    setPidError("");

    const formData = new FormData();
    formData.append("pid", pid);
    formData.append("timestamps", `${pidStart.toFixed(2)},${pidEnd.toFixed(2)}`);

    const controller = new AbortController();
    pidAbortRef.current = controller;

    try {
      const response = await fetch("/api/video/character-from-pid", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `请求失败 (${response.status})`);
      }

      if (!response.body) {
        const text = await response.text();
        const parsed = parseStreamLine(text);
        if (parsed) {
          handlePidStreamPayload(parsed);
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const payload = parseStreamLine(line);
          if (payload) {
            handlePidStreamPayload(payload);
          }
        }
      }

      const finalPayload = parseStreamLine(buffer);
      if (finalPayload) {
        handlePidStreamPayload(finalPayload);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setPidError("已取消创建。");
        setPidStatus("idle");
      } else {
        const message = error instanceof Error ? error.message : "创建失败，请稍后重试。";
        setPidError(message);
        setPidStatus("failed");
      }
    } finally {
      setPidIsSubmitting(false);
      pidAbortRef.current = null;
    }
  };

  const statusLabel =
    status === "running"
      ? progress > 0
        ? `生成中 ${progress}%`
        : "生成中"
      : status === "succeeded"
      ? "生成完成"
      : status === "failed"
      ? "生成失败"
      : "等待提交";

  const clipDuration =
    characterStart !== null && characterEnd !== null
      ? characterEnd - characterStart
      : null;
  const clipTooLong = clipDuration !== null && clipDuration > 3;
  const clipInvalid = clipDuration !== null && clipDuration <= 0;
  const characterReady =
    Boolean(characterVideo) &&
    characterStart !== null &&
    characterEnd !== null &&
    !clipTooLong &&
    !clipInvalid;
  const timelineMax = characterDuration ?? 0;
  const timelineStart = characterStart ?? 0;
  const timelineEnd = characterEnd ?? Math.min(3, timelineMax);
  const startPercent = timelineMax > 0 ? (timelineStart / timelineMax) * 100 : 0;
  const endPercent = timelineMax > 0 ? (timelineEnd / timelineMax) * 100 : 0;
  const timelineStyle = {
    "--range-start": `${startPercent}%`,
    "--range-end": `${endPercent}%`,
  } as CSSProperties;
  const clipLabel =
    clipDuration === null
      ? "请选择 0-3 秒范围"
      : clipInvalid
      ? "结束时间需大于开始时间"
      : clipTooLong
      ? "截取范围超过 3 秒"
      : `已选择 ${clipDuration.toFixed(2)} 秒`;
  const characterStatusLabel =
    characterStatus === "running"
      ? characterProgress > 0
        ? `上传中 ${characterProgress}%`
        : "上传中"
      : characterStatus === "succeeded"
      ? "角色已生成"
      : characterStatus === "failed"
      ? "上传失败"
      : "等待上传";

  const pidClipDuration =
    pidStart !== null && pidEnd !== null ? pidEnd - pidStart : null;
  const pidClipTooLong = pidClipDuration !== null && pidClipDuration > 3;
  const pidClipInvalid = pidClipDuration !== null && pidClipDuration <= 0;
  const pidReady =
    Boolean(pid) && pidStart !== null && pidEnd !== null && !pidClipTooLong && !pidClipInvalid;
  const pidTimelineMax = pidDuration ?? 0;
  const pidTimelineStart = pidStart ?? 0;
  const pidTimelineEnd = pidEnd ?? Math.min(3, pidTimelineMax);
  const pidStartPercent =
    pidTimelineMax > 0 ? (pidTimelineStart / pidTimelineMax) * 100 : 0;
  const pidEndPercent =
    pidTimelineMax > 0 ? (pidTimelineEnd / pidTimelineMax) * 100 : 0;
  const pidTimelineStyle = {
    "--range-start": `${pidStartPercent}%`,
    "--range-end": `${pidEndPercent}%`,
  } as CSSProperties;
  const pidClipLabel =
    pidClipDuration === null
      ? "请选择 0-3 秒范围"
      : pidClipInvalid
      ? "结束时间需大于开始时间"
      : pidClipTooLong
      ? "截取范围超过 3 秒"
      : `已选择 ${pidClipDuration.toFixed(2)} 秒`;
  const pidStatusLabel =
    pidStatus === "running"
      ? pidProgress > 0
        ? `创建中 ${pidProgress}%`
        : "创建中"
      : pidStatus === "succeeded"
      ? "角色已生成"
      : pidStatus === "failed"
      ? "创建失败"
      : "等待创建";

  return (
    <div className="video-page">
      <div className="video-shell">
        <header className="video-header">
          <div>
            <div className="video-title">视频生成</div>
            <div className="video-subtitle">Sora2 · 文生视频 / 图生视频</div>
            <div className="video-badges">
              <span className="video-badge">文生视频</span>
              <span className="video-badge">图生视频（单图）</span>
            </div>
          </div>
          <Link className="video-back" href="/">
            返回聊天
          </Link>
        </header>

        <div className="video-content">
          <div className="video-card equal-height">
            <div className="video-card-header">
              <div>
                <div className="video-card-title">生成设置</div>
                <div className="video-card-subtitle">选择模式并填写提示词</div>
              </div>
            </div>
            <div className="video-mode-toggle" role="tablist" aria-label="生成模式">
              <button
                className={`video-mode${mode === "text" ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={mode === "text"}
                onClick={() => setMode("text")}
                disabled={isSubmitting}
              >
                文生视频
              </button>
              <button
                className={`video-mode${mode === "image" ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={mode === "image"}
                onClick={() => setMode("image")}
                disabled={isSubmitting}
              >
                图生视频
              </button>
            </div>

            {mode === "image" ? (
              <div
                className={`video-dropzone${isDragging ? " dragging" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) {
                    handleFile(file);
                  }
                }}
                onClick={openFilePicker}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openFilePicker();
                  }
                }}
              >
                {previewUrl ? (
                  <img className="video-preview" src={previewUrl} alt="已选择图片预览" />
                ) : (
                  <>
                    <div className="video-drop-title">拖动图片到此处</div>
                    <div className="video-drop-note">仅支持上传一张图片</div>
                  </>
                )}
                <button
                  className="video-upload-button"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openFilePicker();
                  }}
                  disabled={isSubmitting}
                >
                  {previewUrl ? "重新选择" : "选择图片"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleInputChange}
                  hidden
                  disabled={isSubmitting}
                />
                {selectedImage ? (
                  <div className="video-file-meta">
                    {selectedImage.name} · {formatFileSize(selectedImage.size)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="video-text-hint">
                描述你想生成的视频内容、风格、光影与镜头语言。
              </div>
            )}

            <div className="video-prompt">
              <label htmlFor="prompt" className="video-label">
                提示词
              </label>
              <textarea
                id="prompt"
                placeholder="例如：城市夜景，霓虹光，电影感色调"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  resetOutput();
                }}
                disabled={isSubmitting}
              />
            </div>

            <div className="video-advanced">
              <div className="video-advanced-title">高级设置</div>
              <div className="video-advanced-grid">
                <div className="video-field">
                  <label htmlFor="aspectRatio">画面比例</label>
                  <select
                    id="aspectRatio"
                    value={aspectRatio}
                    onChange={(event) => setAspectRatio(event.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                  </select>
                </div>
                <div className="video-field">
                  <label htmlFor="duration">时长</label>
                  <select
                    id="duration"
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="10">10 秒</option>
                    <option value="15">15 秒</option>
                  </select>
                </div>
                <div className="video-field">
                  <label htmlFor="size">清晰度</label>
                  <select
                    id="size"
                    value={size}
                    onChange={(event) => setSize(event.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="small">small</option>
                    <option value="large">large</option>
                  </select>
                </div>
                <div className="video-field">
                  <label htmlFor="remixTargetId">续作 ID</label>
                  <input
                    id="remixTargetId"
                    placeholder="可选"
                    value={remixTargetId}
                    onChange={(event) => setRemixTargetId(event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>

            <div className="video-actions">
              <button
                className="video-generate"
                type="button"
                onClick={handleGenerate}
                disabled={isSubmitting}
              >
                {isSubmitting ? "生成中..." : "生成视频"}
              </button>
              {isSubmitting ? (
                <button className="video-cancel" type="button" onClick={handleCancel}>
                  取消
                </button>
              ) : null}
            </div>
          </div>

          <div className="video-card equal-height">
            <div className="video-card-header">
              <div>
                <div className="video-card-title">生成结果</div>
                <div className="video-card-subtitle">完成后可预览与下载</div>
              </div>
              <div className={`video-status-pill ${status}`}>{statusLabel}</div>
            </div>
            <div className="video-output">
              {resultUrl ? (
                <video
                  src={resultUrl}
                  controls
                  ref={resultVideoRef}
                  onClick={() => setPidClipOpen(true)}
                  onPlay={() => setPidClipOpen(true)}
                  onLoadedMetadata={(event) => {
                    const duration = event.currentTarget.duration;
                    setPidDuration(duration);
                    if (pidStart === null && pidEnd === null) {
                      const initialEnd = Math.min(3, duration);
                      setPidStart(0);
                      setPidEnd(Number(initialEnd.toFixed(2)));
                    }
                  }}
                />
              ) : (
                <div className="video-output-placeholder">
                  {status === "running" ? "生成中，请稍候..." : "生成结果将在这里显示"}
                </div>
              )}
            </div>
            <div className="video-status">
              <div className="video-status-line">
                <span className="video-status-label">{statusLabel}</span>
                {status === "running" ? (
                  <span className="video-status-progress">{progress}%</span>
                ) : null}
              </div>
              {status === "running" ? (
                <div className="video-progress">
                  <div className="video-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              ) : null}
              {taskId ? <div className="video-meta-line">任务 ID：{taskId}</div> : null}
              {pid ? <div className="video-meta-line">Remix ID：{pid}</div> : null}
              {errorMessage ? <div className="video-error">{errorMessage}</div> : null}
            </div>
            <div className="video-actions">
              {resultUrl ? (
                <>
                  <button
                    className="video-secondary"
                    type="button"
                    onClick={() => {
                      setPidClipOpen((prev) => !prev);
                      resetPidOutput();
                    }}
                    disabled={!pid || status !== "succeeded"}
                    title={!pid ? "生成完成后才能创建角色" : undefined}
                  >
                    从视频创建角色
                  </button>
                  <a className="video-download" href={resultUrl} download={downloadName}>
                    下载视频
                  </a>
                </>
              ) : (
                <button className="video-download" type="button" disabled>
                  下载视频
                </button>
              )}
            </div>

            {resultUrl && pidClipOpen ? (
              <div className="pid-character-panel">
                <div className="pid-character-header">
                  <div>
                    <div className="pid-character-title">截取片段创建角色</div>
                    <div className="pid-character-subtitle">
                      从生成视频中截取 0-3 秒
                    </div>
                  </div>
                  <div className={`video-status-pill ${pidStatus}`}>{pidStatusLabel}</div>
                </div>
                <div className="character-trim">
                  <div className="character-trim-caption">拖动时间线选择范围</div>
                  <div className="character-timeline" style={pidTimelineStyle}>
                    <input
                      className="character-range start"
                      type="range"
                      min={0}
                      max={pidTimelineMax}
                      step="0.1"
                      value={pidTimelineStart}
                      onChange={(event) => updatePidStart(event.target.value)}
                      disabled={pidIsSubmitting || pidTimelineMax <= 0}
                    />
                    <input
                      className="character-range end"
                      type="range"
                      min={0}
                      max={pidTimelineMax}
                      step="0.1"
                      value={pidTimelineEnd}
                      onChange={(event) => updatePidEnd(event.target.value)}
                      disabled={pidIsSubmitting || pidTimelineMax <= 0}
                    />
                  </div>
                  <div className="character-timeline-labels">
                    <span>0s</span>
                    <span>{pidTimelineMax > 0 ? `${formatSeconds(pidTimelineMax)}s` : "--"}</span>
                  </div>
                  <div className="character-trim-row">
                    <label htmlFor="pidStart">开始 (秒)</label>
                    <input
                      id="pidStart"
                      type="number"
                      min={0}
                      step="0.1"
                      value={pidStart ?? ""}
                      onChange={(event) => updatePidStart(event.target.value)}
                      disabled={pidIsSubmitting}
                    />
                    <button
                      className="character-trim-button"
                      type="button"
                      onClick={setPidStartFromVideo}
                      disabled={pidIsSubmitting}
                    >
                      取当前
                    </button>
                  </div>
                  <div className="character-trim-row">
                    <label htmlFor="pidEnd">结束 (秒)</label>
                    <input
                      id="pidEnd"
                      type="number"
                      min={0}
                      step="0.1"
                      value={pidEnd ?? ""}
                      onChange={(event) => updatePidEnd(event.target.value)}
                      disabled={pidIsSubmitting}
                    />
                    <button
                      className="character-trim-button"
                      type="button"
                      onClick={setPidEndFromVideo}
                      disabled={pidIsSubmitting}
                    >
                      取当前
                    </button>
                  </div>
                  <div
                    className={`character-trim-meta${
                      pidClipTooLong || pidClipInvalid ? " error" : ""
                    }`}
                  >
                    {pidClipLabel}
                    {pidDuration !== null ? (
                      <span> · 视频时长 {formatSeconds(pidDuration)} 秒</span>
                    ) : null}
                  </div>
                </div>

                <div className="video-actions">
                  <button
                    className="video-generate"
                    type="button"
                    onClick={handlePidCharacterGenerate}
                    disabled={pidIsSubmitting || !pidReady}
                  >
                    {pidIsSubmitting ? "创建中..." : "创建角色"}
                  </button>
                  {pidIsSubmitting ? (
                    <button
                      className="video-cancel"
                      type="button"
                      onClick={() => {
                        pidAbortRef.current?.abort();
                      }}
                    >
                      取消
                    </button>
                  ) : null}
                </div>

                <div className="pid-character-result">
                  {pidCharacterId ? (
                    <div className="character-id-block">
                      <div className="character-id-label">角色 ID</div>
                      <div className="character-id-value">{pidCharacterId}</div>
                      <button
                        className="character-copy"
                        type="button"
                        onClick={copyPidCharacterId}
                      >
                        {pidCopied ? "已复制" : "复制 ID"}
                      </button>
                    </div>
                  ) : (
                    <div className="character-output-placeholder">
                      角色创建完成后将在这里显示角色 ID
                    </div>
                  )}
                  {pidTaskId ? (
                    <div className="video-meta-line">任务 ID：{pidTaskId}</div>
                  ) : null}
                  {pidError ? <div className="video-error">{pidError}</div> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="video-card full">
            <div className="video-card-header">
              <div>
                <div className="video-card-title">角色上传</div>
                <div className="video-card-subtitle">上传视频并截取 0-3 秒创建角色</div>
              </div>
              <div className={`video-status-pill ${characterStatus}`}>
                {characterStatusLabel}
              </div>
            </div>
            <div className="character-hint">生成后可在提示词中 @角色ID 使用</div>

            <div className="character-content">
              <div className="character-panel">
                <div
                  className={`video-dropzone character-dropzone${
                    characterIsDragging ? " dragging" : ""
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCharacterIsDragging(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCharacterIsDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCharacterIsDragging(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) {
                      handleCharacterFile(file);
                    }
                  }}
                  onClick={openCharacterPicker}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openCharacterPicker();
                    }
                  }}
                >
                  {characterPreviewUrl ? (
                    <video
                      className="character-preview"
                      src={characterPreviewUrl}
                      controls
                      ref={characterVideoRef}
                      onClick={() => setCharacterClipOpen(true)}
                      onPlay={() => setCharacterClipOpen(true)}
                      onLoadedMetadata={(event) => {
                        const duration = event.currentTarget.duration;
                        setCharacterDuration(duration);
                        if (characterStart === null && characterEnd === null) {
                          const initialEnd = Math.min(3, duration);
                          setCharacterStart(0);
                          setCharacterEnd(Number(initialEnd.toFixed(2)));
                        }
                      }}
                    />
                  ) : (
                    <>
                      <div className="video-drop-title">拖动视频到此处</div>
                      <div className="video-drop-note">支持从视频中截取 3 秒</div>
                    </>
                  )}
                  <button
                    className="video-upload-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openCharacterPicker();
                    }}
                    disabled={characterIsSubmitting}
                  >
                    {characterPreviewUrl ? "重新选择" : "选择视频"}
                  </button>
                  <input
                    ref={characterInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleCharacterInputChange}
                    hidden
                    disabled={characterIsSubmitting}
                  />
                {characterVideo ? (
                  <div className="video-file-meta">
                    {characterVideo.name} · {formatFileSize(characterVideo.size)}
                  </div>
                ) : null}
              </div>

              {characterPreviewUrl ? (
                <div className="character-clip-toggle">
                  <button
                    className="character-clip-button"
                    type="button"
                    onClick={() => setCharacterClipOpen((prev) => !prev)}
                    disabled={characterIsSubmitting}
                    aria-expanded={characterClipOpen}
                  >
                    {characterClipOpen ? "收起截取范围" : "设置截取范围"}
                  </button>
                  <span className="character-clip-note">
                    在预览时拖动时间线选择 0-3 秒
                  </span>
                </div>
              ) : null}

              {characterPreviewUrl && characterClipOpen ? (
                <div className="character-trim">
                  <div className="character-trim-caption">拖动时间线选择范围</div>
                  <div className="character-timeline" style={timelineStyle}>
                    <input
                      className="character-range start"
                      type="range"
                      min={0}
                      max={timelineMax}
                      step="0.1"
                      value={timelineStart}
                      onChange={(event) => updateStart(event.target.value)}
                      disabled={!characterPreviewUrl || characterIsSubmitting || timelineMax <= 0}
                    />
                    <input
                      className="character-range end"
                      type="range"
                      min={0}
                      max={timelineMax}
                      step="0.1"
                      value={timelineEnd}
                      onChange={(event) => updateEnd(event.target.value)}
                      disabled={!characterPreviewUrl || characterIsSubmitting || timelineMax <= 0}
                    />
                  </div>
                  <div className="character-timeline-labels">
                    <span>0s</span>
                    <span>{timelineMax > 0 ? `${formatSeconds(timelineMax)}s` : "--"}</span>
                  </div>
                  <div className="character-trim-row">
                    <label htmlFor="characterStart">开始 (秒)</label>
                    <input
                      id="characterStart"
                      type="number"
                      min={0}
                      step="0.1"
                      value={characterStart ?? ""}
                      onChange={(event) => updateStart(event.target.value)}
                      disabled={!characterPreviewUrl || characterIsSubmitting}
                    />
                    <button
                      className="character-trim-button"
                      type="button"
                      onClick={setStartFromVideo}
                      disabled={!characterPreviewUrl || characterIsSubmitting}
                    >
                      取当前
                    </button>
                  </div>
                  <div className="character-trim-row">
                    <label htmlFor="characterEnd">结束 (秒)</label>
                    <input
                      id="characterEnd"
                      type="number"
                      min={0}
                      step="0.1"
                      value={characterEnd ?? ""}
                      onChange={(event) => updateEnd(event.target.value)}
                      disabled={!characterPreviewUrl || characterIsSubmitting}
                    />
                    <button
                      className="character-trim-button"
                      type="button"
                      onClick={setEndFromVideo}
                      disabled={!characterPreviewUrl || characterIsSubmitting}
                    >
                      取当前
                    </button>
                  </div>
                  <div
                    className={`character-trim-meta${
                      clipTooLong || clipInvalid ? " error" : ""
                    }`}
                  >
                    {clipLabel}
                    {characterDuration !== null ? (
                      <span> · 视频时长 {formatSeconds(characterDuration)} 秒</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

                <div className="video-actions">
                  <button
                    className="video-generate"
                    type="button"
                    onClick={handleCharacterGenerate}
                    disabled={characterIsSubmitting || !characterReady}
                  >
                    {characterIsSubmitting ? "上传中..." : "上传角色"}
                  </button>
                  {characterIsSubmitting ? (
                    <button className="video-cancel" type="button" onClick={handleCharacterCancel}>
                      取消
                    </button>
                  ) : null}
                  {characterPreviewUrl ? (
                    <button
                      className="video-cancel"
                      type="button"
                      onClick={() => {
                        resetCharacterSelection();
                        resetCharacterOutput();
                      }}
                      disabled={characterIsSubmitting}
                    >
                      清空
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="character-panel">
                <div className="character-output">
                  {characterId ? (
                    <div className="character-id-block">
                      <div className="character-id-label">角色 ID</div>
                      <div className="character-id-value">{characterId}</div>
                      <button
                        className="character-copy"
                        type="button"
                        onClick={copyCharacterId}
                      >
                        {characterCopied ? "已复制" : "复制 ID"}
                      </button>
                    </div>
                  ) : (
                    <div className="character-output-placeholder">
                      上传角色后将在这里显示角色 ID
                    </div>
                  )}
                </div>
                <div className="video-status">
                  <div className="video-status-line">
                    <span className="video-status-label">{characterStatusLabel}</span>
                    {characterStatus === "running" ? (
                      <span className="video-status-progress">{characterProgress}%</span>
                    ) : null}
                  </div>
                  {characterStatus === "running" ? (
                    <div className="video-progress">
                      <div
                        className="video-progress-bar"
                        style={{ width: `${characterProgress}%` }}
                      />
                    </div>
                  ) : null}
                  {characterTaskId ? (
                    <div className="video-meta-line">任务 ID：{characterTaskId}</div>
                  ) : null}
                  {characterError ? (
                    <div className="video-error">{characterError}</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
