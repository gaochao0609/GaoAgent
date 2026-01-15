import { useRef, useState, useEffect } from "react";
import { useFileUpload } from "../hooks/useFileUpload";
import { ClipSelector } from "./ClipSelector";
import { formatFileSize, copyTextToClipboard } from "../lib/utils";

type CharacterStatusState = "idle" | "running" | "succeeded" | "failed";

interface CharacterUploaderProps {
  label: string;
  description: string;
  onComplete?: (characterId: string) => void;
  apiEndpoint: string;
  getFormData: (file: File, start: number, end: number) => FormData;
}

export function CharacterUploader({
  label,
  description,
  onComplete,
  apiEndpoint,
  getFormData,
}: CharacterUploaderProps) {
  const [clipOpen, setClipOpen] = useState(false);
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<CharacterStatusState>("idle");
  const [taskId, setTaskId] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const fileUpload = useFileUpload("video/*", false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    return () => fileUpload.cleanup();
  }, [fileUpload]);

  const resetOutput = () => {
    if (isSubmitting) return;
    setStatus("idle");
    setProgress(0);
    setTaskId("");
    setCharacterId("");
    setErrorMessage("");
    setCopied(false);
    setIsStreaming(false);
  };

  const resetSelection = () => {
    fileUpload.cleanup();
    fileUpload.clearFiles();
    setStart(null);
    setEnd(null);
    setDuration(null);
    setClipOpen(false);
    resetOutput();
  };

  const handleFileChange = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setErrorMessage("仅支持上传视频文件。");
      return;
    }
    resetOutput();
    resetSelection();
    const url = URL.createObjectURL(file);
    fileUpload.setFiles([file]);
    fileUpload.setPreviewUrls([url]);
    setClipOpen(false);
  };

  const updateStart = (value: string) => {
    resetOutput();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setStart(null);
      return;
    }
    const maxSpan = duration ? Math.min(3, duration) : 3;
    const maxValue = duration ?? Number.POSITIVE_INFINITY;
    const nextStart = Math.min(Math.max(parsed, 0), maxValue);
    let nextEnd = end ?? nextStart;
    if (nextEnd < nextStart) nextEnd = nextStart;
    if (nextEnd - nextStart > maxSpan) {
      nextEnd = Math.min(nextStart + maxSpan, maxValue);
    }
    setStart(Number(nextStart.toFixed(2)));
    setEnd(Number(nextEnd.toFixed(2)));
  };

  const updateEnd = (value: string) => {
    resetOutput();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setEnd(null);
      return;
    }
    const maxSpan = duration ? Math.min(3, duration) : 3;
    const maxValue = duration ?? Number.POSITIVE_INFINITY;
    const nextEnd = Math.min(Math.max(parsed, 0), maxValue);
    let nextStart = start ?? nextEnd;
    if (nextEnd < nextStart) nextStart = nextEnd;
    if (nextEnd - nextStart > maxSpan) {
      nextStart = Math.max(0, nextEnd - maxSpan);
    }
    setStart(Number(nextStart.toFixed(2)));
    setEnd(Number(nextEnd.toFixed(2)));
  };

  const setStartFromVideo = () => {
    const current = videoRef.current?.currentTime;
    if (current === undefined) return;
    updateStart(current.toFixed(2));
  };

  const setEndFromVideo = () => {
    const current = videoRef.current?.currentTime;
    if (current === undefined) return;
    updateEnd(current.toFixed(2));
  };

  const handleGenerate = async () => {
    if (isSubmitting) return;
    if (fileUpload.files.length === 0) {
      setErrorMessage("请先上传视频文件。");
      return;
    }
    if (start === null || end === null) {
      setErrorMessage("请设置截取范围。");
      return;
    }
    const clipLength = end - start;
    if (clipLength <= 0) {
      setErrorMessage("结束时间需大于开始时间。");
      return;
    }
    if (clipLength > 3) {
      setErrorMessage("截取范围不能超过 3 秒。");
      return;
    }

    setIsSubmitting(true);
    setStatus("running");
    setProgress(0);
    setTaskId("");
    setCharacterId("");
    setErrorMessage("");
    setIsStreaming(true);

    const formData = getFormData(fileUpload.files[0], start, end);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(apiEndpoint, {
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
        const parsed = JSON.parse(text);
        handleStreamPayload(parsed);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const payload = parseStreamLine(line);
          if (payload) {
            handleStreamPayload(payload);
          }
        }
      }

      const finalPayload = parseStreamLine(buffer);
      if (finalPayload) {
        handleStreamPayload(finalPayload);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setErrorMessage("已取消上传。");
        setStatus("idle");
      } else {
        const message = error instanceof Error ? error.message : "上传失败，请稍后重试。";
        setErrorMessage(message);
        setStatus("failed");
      }
    } finally {
      setIsSubmitting(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const parseStreamLine = (line: string) => {
    if (!line.trim()) return null;
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  };

  const handleStreamPayload = (payload: any) => {
    if (
      typeof payload.code === "number" &&
      payload.code === 0 &&
      payload.data &&
      typeof payload.data.id === "string"
    ) {
      setTaskId(payload.data.id);
      setStatus("running");
      return;
    }

    if (typeof payload.id === "string") {
      setTaskId(payload.id);
    }
    if (typeof payload.progress === "number") {
      setProgress(Math.min(100, Math.max(0, Math.round(payload.progress))));
    }
    if (typeof payload.status === "string") {
      if (payload.status === "running") setStatus("running");
      else if (payload.status === "succeeded") setStatus("succeeded");
      else if (payload.status === "failed") setStatus("failed");
    }

    const results = payload.results;
    if (Array.isArray(results) && results.length > 0 && results[0]?.character_id) {
      setCharacterId(results[0].character_id);
      setStatus("succeeded");
      onComplete?.(results[0].character_id);
    }

    const failureReason = typeof payload.failure_reason === "string" ? payload.failure_reason : "";
    const errorDetail = typeof payload.error === "string" ? payload.error : "";
    if (failureReason || errorDetail) {
      setErrorMessage(failureReason === "input_moderation" 
        ? "输入内容可能涉及违规" 
        : failureReason === "output_moderation"
        ? "生成内容未通过审核"
        : errorDetail || "上传失败");
      if (payload.status === "failed") setStatus("failed");
    }
  };

  const copyCharacterId = async () => {
    if (!characterId) return;
    try {
      await copyTextToClipboard(characterId);
      setCopied(true);
    } catch {
      setErrorMessage("复制失败，请手动复制角色 ID。");
    }
  };

  const statusLabel =
    status === "running"
      ? progress > 0
        ? `${isStreaming ? "上传中" : "创建中"} ${progress}%`
        : isStreaming
        ? "上传中"
        : "创建中"
      : status === "succeeded"
      ? "角色已生成"
      : status === "failed"
      ? "上传失败"
      : "等待上传";

  return (
    <div className="character-panel">
      <div
        className={`video-dropzone character-dropzone${fileUpload.isDragging ? " dragging" : ""}`}
        onDragEnter={fileUpload.handleDragEnter}
        onDragOver={fileUpload.handleDragOver}
        onDragLeave={fileUpload.handleDragLeave}
        onDrop={fileUpload.handleDrop}
        onClick={fileUpload.openFilePicker}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileUpload.openFilePicker();
          }
        }}
      >
        {fileUpload.previewUrls.length > 0 ? (
          <video
            className="character-preview"
            src={fileUpload.previewUrls[0]}
            controls
            ref={videoRef}
            onClick={() => setClipOpen(true)}
            onPlay={() => setClipOpen(true)}
            onLoadedMetadata={(event) => {
              const vidDuration = event.currentTarget.duration;
              setDuration(vidDuration);
              if (start === null && end === null) {
                const initialEnd = Math.min(3, vidDuration);
                setStart(0);
                setEnd(Number(initialEnd.toFixed(2)));
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
            fileUpload.openFilePicker();
          }}
          disabled={isSubmitting}
        >
          {fileUpload.previewUrls.length > 0 ? "重新选择" : "选择视频"}
        </button>
        <input
          ref={fileUpload.fileInputRef}
          type="file"
          accept="video/*"
          onChange={(event) => {
            fileUpload.handleInputChange(event);
            if (event.target.files?.[0]) {
              handleFileChange(event.target.files[0]);
            }
            event.target.value = "";
          }}
          hidden
          disabled={isSubmitting}
        />
        {fileUpload.files.length > 0 ? (
          <div className="video-file-meta">
            {fileUpload.files[0].name} · {formatFileSize(fileUpload.files[0].size)}
          </div>
        ) : null}
      </div>

      {fileUpload.previewUrls.length > 0 && (
        <div className="character-clip-toggle">
          <button
            className="character-clip-button"
            type="button"
            onClick={() => setClipOpen((prev) => !prev)}
            disabled={isSubmitting}
            aria-expanded={clipOpen}
          >
            {clipOpen ? "收起截取范围" : "设置截取范围"}
          </button>
          <span className="character-clip-note">
            在预览时拖动时间线选择 0-3 秒
          </span>
        </div>
      )}

      {fileUpload.previewUrls.length > 0 && clipOpen && (
        <ClipSelector
          duration={duration}
          start={start}
          end={end}
          onStartChange={updateStart}
          onEndChange={updateEnd}
          onSetStartFromCurrent={setStartFromVideo}
          onSetEndFromCurrent={setEndFromVideo}
          disabled={isSubmitting}
          showSetCurrentButtons
        />
      )}

      <div className="video-actions">
        <button
          className="video-generate"
          type="button"
          onClick={handleGenerate}
          disabled={isSubmitting || !fileUpload.files.length || start === null || end === null}
        >
          {isSubmitting ? "生成中..." : label}
        </button>
        {isSubmitting && (
          <button
            className="video-cancel"
            type="button"
            onClick={() => abortRef.current?.abort()}
          >
            取消
          </button>
        )}
      </div>

      {characterId ? (
        <div className="character-id-block">
          <div className="character-id-label">角色 ID</div>
          <div className="character-id-value">{characterId}</div>
          <button className="character-copy" type="button" onClick={copyCharacterId}>
            {copied ? "已复制" : "复制 ID"}
          </button>
        </div>
      ) : (
        <div className="character-output-placeholder">角色 ID 将在这里显示</div>
      )}

      {taskId && <div className="video-meta-line">任务 ID：{taskId}</div>}
      {errorMessage && <div className="video-error">{errorMessage}</div>}
    </div>
  );
}
