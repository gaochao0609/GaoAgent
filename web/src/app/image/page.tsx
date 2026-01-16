"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useJobPoll } from "@/hooks/useJobPoll";
import { formatFileSize } from "@/lib/utils";

export default function ImagePage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("nano-banana-pro");
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [imageSize, setImageSize] = useState("1K");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultContent, setResultContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileUpload = useFileUpload("image/*", true);
  const jobPoll = useJobPoll();
  const abortRef = useRef<AbortController | null>(null);

  const totalSize = fileUpload.files.reduce((sum: number, file: File) => sum + file.size, 0);
  const downloadName = fileUpload.files.length
    ? `generated-${fileUpload.files[0].name}`
    : "generated-image.png";

  useEffect(() => {
    if (resultUrl && !fileUpload.previewUrls.includes(resultUrl)) {
      if (resultUrl.startsWith("blob:")) {
        URL.revokeObjectURL(resultUrl);
      }
    }
    return () => fileUpload.cleanup();
  }, [resultUrl, fileUpload]);

  useEffect(() => {
    if (jobPoll.status === "failed" || jobPoll.status === "succeeded") {
      setIsSubmitting(false);
    }
  }, [jobPoll.status]);

  const resetJobState = () => {
    jobPoll.resetJob();
    setResultUrl(null);
    setResultContent("");
    setIsSubmitting(false);
  };

  const resetAll = () => {
    resetJobState();
    fileUpload.clearFiles();
  };

  const handleFilesChange = () => {
    resetJobState();
  };

  const handleGenerate = () => {
    if (isSubmitting) return;
    if (!prompt.trim()) {
      jobPoll.setErrorMessage("请输入提示词。");
      return;
    }

    resetJobState();
    setIsSubmitting(true);
    jobPoll.setStatus("running");

    const formData = new FormData();
    formData.append("prompt", prompt.trim());
    formData.append("model", model);
    formData.append("aspectRatio", aspectRatio);
    formData.append("imageSize", imageSize);
    fileUpload.files.forEach((file: File) => {
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

        const payload = (await response.json()) as { request_id?: string };
        const requestId = typeof payload.request_id === "string" ? payload.request_id : "";

        if (!requestId) {
          throw new Error("后端未返回任务 ID。");
        }

        jobPoll.setTaskId(requestId);
        jobPoll.startPolling(requestId, (data: any) => {
          if (data?.result?.url) {
            setResultUrl(data.result.url);
            setIsSubmitting(false);
          }
          if (data?.result?.content) {
            setResultContent(data.result.content);
          }
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          jobPoll.setErrorMessage("已取消生成。");
          jobPoll.setStatus("idle");
        } else {
          const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
          jobPoll.setErrorMessage(message);
          jobPoll.setStatus("failed");
        }
        setIsSubmitting(false);
      } finally {
        abortRef.current = null;
      }
    })();
  };

  const statusLabel =
    jobPoll.status === "running"
      ? jobPoll.progress > 0
        ? `生成中 ${jobPoll.progress}%`
        : "生成中"
      : jobPoll.status === "succeeded"
      ? "生成完成"
      : jobPoll.status === "failed"
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
              className={`image-dropzone${fileUpload.isDragging ? " dragging" : ""}`}
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
                <div className="image-preview-grid">
                  {fileUpload.previewUrls.map((url: string, index: number) => (
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
                  fileUpload.openFilePicker();
                  handleFilesChange();
                }}
                disabled={isSubmitting}
              >
                {fileUpload.previewUrls.length > 0 ? "重新选择" : "选择图片"}
              </button>
              <input
                ref={fileUpload.fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  fileUpload.handleInputChange(event);
                  handleFilesChange();
                }}
                hidden
                disabled={isSubmitting}
              />
              {fileUpload.files.length > 0 ? (
                <div className="image-file-meta">
                  已选择 {fileUpload.files.length} 张 · {formatFileSize(totalSize)}
                  <button
                    className="image-clear"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      resetAll();
                    }}
                    disabled={isSubmitting}
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
                  if (jobPoll.status === "succeeded") {
                    jobPoll.setStatus("idle");
                  }
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
              <div className={`image-status-pill ${jobPoll.status}`}>{statusLabel}</div>
            </div>

            <div className="image-output">
              {resultUrl ? (
                <img src={resultUrl} alt="生成结果" />
              ) : (
                <div className="image-output-placeholder">
                  {jobPoll.status === "running" ? "生成中，请稍候..." : "生成结果将在这里显示"}
                </div>
              )}
            </div>

            <div className="image-status">
              <div className="image-status-line">
                <span className="image-status-label">{statusLabel}</span>
                {jobPoll.status === "running" ? (
                  <span className="image-status-progress">{jobPoll.progress}%</span>
                ) : null}
              </div>
              {jobPoll.status === "running" ? (
                <div className="image-progress">
                  <div className="image-progress-bar" style={{ width: `${jobPoll.progress}%` }} />
                </div>
              ) : null}
              {jobPoll.taskId ? (
                <div className="image-meta-line">任务 ID：{jobPoll.taskId}</div>
              ) : null}
              {resultContent ? <div className="image-meta-line">描述：{resultContent}</div> : null}
              {jobPoll.errorMessage ? (
                <div className="image-error">{jobPoll.errorMessage}</div>
              ) : null}
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
