"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
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

const POLL_INTERVAL_MS = 1500;

export default function ImagePage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("nano-banana-pro");
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [imageSize, setImageSize] = useState("1K");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultContent, setResultContent] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<StatusState>("idle");
  const [taskId, setTaskId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<number | null>(null);
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const downloadName = selectedFiles.length
    ? `generated-${selectedFiles[0].name}`
    : "generated-image.png";

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      if (resultUrl && !previewUrls.includes(resultUrl)) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [previewUrls, resultUrl]);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const handleFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (incoming.length === 0) {
      return;
    }
    stopPolling();
    const nextUrls = incoming.map((file) => URL.createObjectURL(file));
    setSelectedFiles(incoming);
    setPreviewUrls(nextUrls);
    setResultUrl(null);
    setResultContent("");
    setStatus("idle");
    setProgress(0);
    setTaskId("");
    setErrorMessage("");
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    event.target.value = "";
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const applyJobPayload = (payload: Record<string, unknown>) => {
    if (typeof payload.type === "string" && payload.type !== "image") {
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
      const record = result as { url?: unknown; content?: unknown };
      if (typeof record.url === "string") {
        setResultUrl(record.url);
        setStatus("succeeded");
        setIsSubmitting(false);
        stopPolling();
      }
      if (typeof record.content === "string") {
        setResultContent(record.content);
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

  const pollJob = async (id: string) => {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      applyJobPayload(payload);
      if (payload.status === "running" || payload.status === "submitted") {
        pollRef.current = window.setTimeout(() => void pollJob(id), POLL_INTERVAL_MS);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "生成失败，请稍后重试。";
      setErrorMessage(message);
      setStatus("failed");
      setIsSubmitting(false);
      stopPolling();
    }
  };

  const handleGenerate = () => {
    if (isSubmitting) {
      return;
    }
    if (!prompt.trim()) {
      setErrorMessage("请输入提示词。");
      return;
    }
    stopPolling();
    setIsSubmitting(true);
    setStatus("running");
    setProgress(0);
    setTaskId("");
    setErrorMessage("");
    setResultUrl(null);
    setResultContent("");

    const formData = new FormData();
    formData.append("prompt", prompt.trim());
    formData.append("model", model);
    formData.append("aspectRatio", aspectRatio);
    formData.append("imageSize", imageSize);
    selectedFiles.forEach((file) => {
      formData.append("images", file);
    });

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const response = await fetch("/api/image/nano-banana", {
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
        pollJob(requestId);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setErrorMessage("已取消生成。");
          setStatus("idle");
          setIsSubmitting(false);
          stopPolling();
        } else {
          const message =
            error instanceof Error ? error.message : "生成失败，请稍后重试。";
          setErrorMessage(message);
          setStatus("failed");
          setIsSubmitting(false);
          stopPolling();
        }
      } finally {
        abortRef.current = null;
      }
    })();
  };

  const clearSelection = () => {
    stopPolling();
    setSelectedFiles([]);
    setPreviewUrls([]);
    setResultUrl(null);
    setResultContent("");
    setStatus("idle");
    setProgress(0);
    setTaskId("");
    setErrorMessage("");
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

  return (
    <div className="image-page">
      <div className="image-shell">
        <header className="image-header">
          <div>
            <div className="image-title">图片生成</div>
            <div className="image-subtitle">Nano Banana Pro · 多图合成</div>
            <div className="image-badges">
              <span className="image-badge">支持多张图片</span>
              <span className="image-badge muted">智能合成</span>
            </div>
          </div>
          <Link className="image-back" href="/">
            返回聊天
          </Link>
        </header>

        <div className="image-content">
          <div className="image-card">
            <div className="image-card-header">
              <div>
                <div className="image-card-title">生成设置</div>
                <div className="image-card-subtitle">选择模型并填写提示词</div>
              </div>
            </div>
            <div
              className={`image-dropzone${isDragging ? " dragging" : ""}`}
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
                const files = event.dataTransfer.files;
                if (files && files.length > 0) {
                  handleFiles(files);
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
              {previewUrls.length > 0 ? (
                <div className="image-preview-grid">
                  {previewUrls.map((url, index) => (
                    <img
                      key={`${url}-${index}`}
                      className="image-preview"
                      src={url}
                      alt={`已选择图片 ${index + 1}`}
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div className="image-drop-title">拖动图片到此处</div>
                  <div className="image-drop-note">或点击一次选择多张图片</div>
                </>
              )}
              <button
                className="image-upload-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openFilePicker();
                }}
              >
                {previewUrls.length > 0 ? "重新选择" : "选择图片"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleInputChange}
                hidden
              />
              {selectedFiles.length > 0 ? (
                <div className="image-file-meta">
                  已选择 {selectedFiles.length} 张 · {formatFileSize(totalSize)}
                  <button
                    className="image-clear"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearSelection();
                    }}
                  >
                    清空
                  </button>
                </div>
              ) : null}
            </div>

            <div className="image-advanced">
              <div className="image-advanced-title">模型与参数</div>
              <div className="image-advanced-grid">
                <div className="image-field">
                  <label htmlFor="model">模型</label>
                  <select
                    id="model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="nano-banana-pro">nano-banana-pro</option>
                    <option value="nano-banana-pro-cl">nano-banana-pro-cl</option>
                  </select>
                </div>
                <div className="image-field">
                  <label htmlFor="aspectRatio">画面比例</label>
                  <select
                    id="aspectRatio"
                    value={aspectRatio}
                    onChange={(event) => setAspectRatio(event.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="auto">auto</option>
                    <option value="1:1">1:1</option>
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="4:3">4:3</option>
                    <option value="3:4">3:4</option>
                    <option value="3:2">3:2</option>
                    <option value="2:3">2:3</option>
                    <option value="5:4">5:4</option>
                    <option value="4:5">4:5</option>
                    <option value="21:9">21:9</option>
                  </select>
                </div>
                <div className="image-field">
                  <label htmlFor="imageSize">输出尺寸</label>
                  <select
                    id="imageSize"
                    value={imageSize}
                    onChange={(event) => setImageSize(event.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="image-prompt">
              <label htmlFor="prompt" className="image-label">
                提示词
              </label>
              <textarea
                id="prompt"
                placeholder="例如：清晨的海边城市，柔和光线，写实风格"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setStatus("idle");
                }}
                disabled={isSubmitting}
              />
            </div>

            <div className="image-actions">
              <button
                className="image-generate"
                type="button"
                onClick={handleGenerate}
                disabled={isSubmitting || prompt.trim().length === 0}
              >
                {isSubmitting ? "生成中..." : "生成图片"}
              </button>
            </div>
          </div>

          <div className="image-card">
            <div className="image-card-header">
              <div>
                <div className="image-card-title">生成结果</div>
                <div className="image-card-subtitle">完成后可预览与下载</div>
              </div>
              <div className={`image-status-pill ${status}`}>{statusLabel}</div>
            </div>
            <div className="image-output">
              {resultUrl ? (
                <img src={resultUrl} alt="生成结果" />
              ) : (
                <div className="image-output-placeholder">
                  {status === "running" ? "生成中，请稍候..." : "生成结果将在这里显示"}
                </div>
              )}
            </div>
            <div className="image-status">
              <div className="image-status-line">
                <span className="image-status-label">{statusLabel}</span>
                {status === "running" ? (
                  <span className="image-status-progress">{progress}%</span>
                ) : null}
              </div>
              {status === "running" ? (
                <div className="image-progress">
                  <div className="image-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              ) : null}
              {taskId ? <div className="image-meta-line">任务 ID：{taskId}</div> : null}
              {resultContent ? (
                <div className="image-meta-line">描述：{resultContent}</div>
              ) : null}
              {errorMessage ? <div className="image-error">{errorMessage}</div> : null}
            </div>
            <div className="image-actions">
              {resultUrl ? (
                <a className="image-download" href={resultUrl} download={downloadName}>
                  下载图片
                </a>
              ) : (
                <button className="image-download" type="button" disabled>
                  下载图片
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
