import { useRef, useState, useEffect } from "react";
import { useFileUpload } from "../hooks/useFileUpload";
import { useJobPoll } from "../hooks/useJobPoll";
import { ClipSelector } from "./ClipSelector";
import { formatFileSize, copyTextToClipboard } from "../lib/utils";

export function VideoGenerator() {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [duration, setDuration] = useState("15");
  const [size, setSize] = useState("small");
  const [remixTargetId, setRemixTargetId] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [pid, setPid] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pidClipOpen, setPidClipOpen] = useState(false);
  const [pidStart, setPidStart] = useState<number | null>(null);
  const [pidEnd, setPidEnd] = useState<number | null>(null);
  const [pidDuration, setPidDuration] = useState<number | null>(null);
  
  const imageUpload = useFileUpload("image/*", false);
  const jobPoll = useJobPoll();
  const abortRef = useRef<AbortController | null>(null);
  const resultVideoRef = useRef<HTMLVideoElement | null>(null);

  const downloadName = imageUpload.files.length
    ? `generated-${imageUpload.files[0].name}`
    : "generated-video.mp4";

  useEffect(() => {
    return () => {
      imageUpload.cleanup();
      if (resultUrl && !imageUpload.previewUrls.includes(resultUrl)) {
        if (resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl, imageUpload]);

  const resetOutput = () => {
    if (isSubmitting) return;
    jobPoll.resetJob();
    setPid("");
    setResultUrl(null);
    setPidClipOpen(false);
  };

  useEffect(() => {
    jobPoll.setStatus("idle");
    jobPoll.setProgress(0);
    jobPoll.setTaskId("");
    setPid("");
    jobPoll.setErrorMessage("");
    setResultUrl(null);
    if (mode === "text") {
      imageUpload.clearFiles();
    }
  }, [mode]);

  const updatePidStart = (value: string) => {
    jobPoll.resetJob();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setPidStart(null);
      return;
    }
    const maxSpan = pidDuration ? Math.min(3, pidDuration) : 3;
    const maxValue = pidDuration ?? Number.POSITIVE_INFINITY;
    const nextStart = Math.min(Math.max(parsed, 0), maxValue);
    let nextEnd = pidEnd ?? nextStart;
    if (nextEnd < nextStart) nextEnd = nextStart;
    if (nextEnd - nextStart > maxSpan) {
      nextEnd = Math.min(nextStart + maxSpan, maxValue);
    }
    setPidStart(Number(nextStart.toFixed(2)));
    setPidEnd(Number(nextEnd.toFixed(2)));
  };

  const updatePidEnd = (value: string) => {
    jobPoll.resetJob();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setPidEnd(null);
      return;
    }
    const maxSpan = pidDuration ? Math.min(3, pidDuration) : 3;
    const maxValue = pidDuration ?? Number.POSITIVE_INFINITY;
    const nextEnd = Math.min(Math.max(parsed, 0), maxValue);
    let nextStart = pidStart ?? nextEnd;
    if (nextEnd < nextStart) nextStart = nextEnd;
    if (nextEnd - nextStart > maxSpan) {
      nextStart = Math.max(0, nextEnd - maxSpan);
    }
    setPidStart(Number(nextStart.toFixed(2)));
    setPidEnd(Number(nextEnd.toFixed(2)));
  };

  const setPidStartFromVideo = () => {
    const current = resultVideoRef.current?.currentTime;
    if (current === undefined) return;
    updatePidStart(current.toFixed(2));
  };

  const setPidEndFromVideo = () => {
    const current = resultVideoRef.current?.currentTime;
    if (current === undefined) return;
    updatePidEnd(current.toFixed(2));
  };

  const handleGenerate = async () => {
    if (isSubmitting) return;
    if (!prompt.trim()) {
      jobPoll.setErrorMessage("请输入提示词。");
      return;
    }
    if (mode === "image" && imageUpload.files.length === 0) {
      jobPoll.setErrorMessage("图生视频需要上传一张参考图。");
      return;
    }

    resetOutput();
    setIsSubmitting(true);
    jobPoll.setStatus("running");
    jobPoll.setProgress(0);
    jobPoll.setTaskId("");
    jobPoll.setErrorMessage("");
    setResultUrl(null);
    setPidClipOpen(false);

    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("prompt", prompt.trim());
    formData.append("aspectRatio", aspectRatio);
    formData.append("duration", duration);
    formData.append("size", size);
    formData.append("remixTargetId", remixTargetId.trim());
    if (mode === "image" && imageUpload.files.length > 0) {
      formData.append("image", imageUpload.files[0]);
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

      const payload = await response.json() as { request_id?: string };
      const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
      
      if (!requestId) {
        throw new Error("后端未返回任务 ID");
      }

      jobPoll.setTaskId(requestId);
      jobPoll.startPolling(requestId, (data) => {
        if (data?.result?.url) {
          setResultUrl(data.result.url);
          setIsSubmitting(false);
        }
        if (data?.result?.pid) {
          setPid(data.result.pid);
        }
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        jobPoll.setErrorMessage("已取消生成。");
        jobPoll.setStatus("idle");
        setIsSubmitting(false);
      } else {
        const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
        jobPoll.setErrorMessage(message);
        jobPoll.setStatus("failed");
        setIsSubmitting(false);
      }
    } finally {
      abortRef.current = null;
    }
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

  const pidClipTooLong = pidStart !== null && pidEnd !== null && pidEnd - pidStart > 3;
  const pidClipInvalid = pidStart !== null && pidEnd !== null && pidEnd - pidStart <= 0;
  const pidReady = Boolean(pid) && pidStart !== null && pidEnd !== null && !pidClipTooLong && !pidClipInvalid;

  return (
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
            className={`video-dropzone${imageUpload.isDragging ? " dragging" : ""}`}
            onDragEnter={imageUpload.handleDragEnter}
            onDragOver={imageUpload.handleDragOver}
            onDragLeave={imageUpload.handleDragLeave}
            onDrop={imageUpload.handleDrop}
            onClick={imageUpload.openFilePicker}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                imageUpload.openFilePicker();
              }
            }}
          >
            {imageUpload.previewUrls.length > 0 ? (
              <img className="video-preview" src={imageUpload.previewUrls[0]} alt="已选择图片预览" />
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
                imageUpload.openFilePicker();
              }}
              disabled={isSubmitting}
            >
              {imageUpload.previewUrls.length > 0 ? "重新选择" : "选择图片"}
            </button>
            <input
              ref={imageUpload.fileInputRef}
              type="file"
              accept="image/*"
              onChange={imageUpload.handleInputChange}
              hidden
              disabled={isSubmitting}
            />
            {imageUpload.files.length > 0 ? (
              <div className="video-file-meta">
                {imageUpload.files[0].name} · {formatFileSize(imageUpload.files[0].size)}
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
          {isSubmitting && (
            <button className="video-cancel" type="button" onClick={() => abortRef.current?.abort()}>
              取消
            </button>
          )}
        </div>
      </div>

      <div className="video-card equal-height">
        <div className="video-card-header">
          <div>
            <div className="video-card-title">生成结果</div>
            <div className="video-card-subtitle">完成后可预览与下载</div>
          </div>
          <div className={`video-status-pill ${jobPoll.status}`}>{statusLabel}</div>
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
              {jobPoll.status === "running" ? "生成中，请稍候..." : "生成结果将在这里显示"}
            </div>
          )}
        </div>

        <div className="video-status">
          <div className="video-status-line">
            <span className="video-status-label">{statusLabel}</span>
            {jobPoll.status === "running" ? (
              <span className="video-status-progress">{jobPoll.progress}%</span>
            ) : null}
          </div>
          {jobPoll.status === "running" ? (
            <div className="video-progress">
              <div className="video-progress-bar" style={{ width: `${jobPoll.progress}%` }} />
            </div>
          ) : null}
          {jobPoll.taskId ? <div className="video-meta-line">任务 ID：{jobPoll.taskId}</div> : null}
          {pid ? <div className="video-meta-line">Remix ID：{pid}</div> : null}
          {jobPoll.errorMessage ? <div className="video-error">{jobPoll.errorMessage}</div> : null}
        </div>

        <div className="video-actions">
          {resultUrl ? (
            <>
              <button
                className="video-secondary"
                type="button"
                onClick={() => {
                  setPidClipOpen((prev) => !prev);
                  jobPoll.resetJob();
                }}
                disabled={!pid || jobPoll.status !== "succeeded"}
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

        {resultUrl && pidClipOpen && (
          <div className="pid-character-panel">
            <PidCharacterPanel
              pid={pid}
              duration={pidDuration}
              start={pidStart}
              end={pidEnd}
              onStartChange={updatePidStart}
              onEndChange={updatePidEnd}
              onSetStartFromCurrent={setPidStartFromVideo}
              onSetEndFromCurrent={setPidEndFromVideo}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface PidCharacterPanelProps {
  pid: string;
  duration: number | null;
  start: number | null;
  end: number | null;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onSetStartFromCurrent: () => void;
  onSetEndFromCurrent: () => void;
}

function PidCharacterPanel({
  pid,
  duration,
  start,
  end,
  onStartChange,
  onEndChange,
  onSetStartFromCurrent,
  onSetEndFromCurrent,
}: PidCharacterPanelProps) {
  const [status, setStatus] = useState<"idle" | "running" | "succeeded" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleGenerate = async () => {
    if (isSubmitting) return;
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

    const formData = new FormData();
    formData.append("pid", pid);
    formData.append("timestamps", `${start.toFixed(2)},${end.toFixed(2)}`);

    const controller = new AbortController();
    abortRef.current = controller;

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

      const payload = await response.json() as { request_id?: string; character_id?: string };
      const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
      
      setTaskId(requestId);
      setStatus("succeeded");
      
      if (typeof payload.character_id === "string") {
        setCharacterId(payload.character_id);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setErrorMessage("已取消创建。");
        setStatus("idle");
      } else {
        const message = error instanceof Error ? error.message : "创建失败，请稍后重试。";
        setErrorMessage(message);
        setStatus("failed");
      }
    } finally {
      setIsSubmitting(false);
      abortRef.current = null;
    }
  };

  const statusLabel =
    status === "running"
      ? progress > 0
        ? `创建中 ${progress}%`
        : "创建中"
      : status === "succeeded"
      ? "角色已生成"
      : status === "failed"
      ? "创建失败"
      : "等待创建";

  const clipTooLong = start !== null && end !== null && end - start > 3;
  const clipInvalid = start !== null && end !== null && end - start <= 0;
  const ready = Boolean(pid) && start !== null && end !== null && !clipTooLong && !clipInvalid;

  const copyCharacterId = async () => {
    if (!characterId) return;
    try {
      await copyTextToClipboard(characterId);
      setCopied(true);
    } catch {
      setErrorMessage("复制失败，请手动复制角色 ID。");
    }
  };

  return (
    <>
      <div className="pid-character-header">
        <div>
          <div className="pid-character-title">截取片段创建角色</div>
          <div className="pid-character-subtitle">从生成视频中截取 0-3 秒</div>
        </div>
        <div className={`video-status-pill ${status}`}>{statusLabel}</div>
      </div>

      <ClipSelector
        duration={duration}
        start={start}
        end={end}
        onStartChange={onStartChange}
        onEndChange={onEndChange}
        onSetStartFromCurrent={onSetStartFromCurrent}
        onSetEndFromCurrent={onSetEndFromCurrent}
        disabled={isSubmitting}
        showSetCurrentButtons
      />

      <div className="video-actions">
        <button
          className="video-generate"
          type="button"
          onClick={handleGenerate}
          disabled={isSubmitting || !ready}
        >
          {isSubmitting ? "创建中..." : "创建角色"}
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
        <div className="character-output-placeholder">
          角色创建完成后将在这里显示角色 ID
        </div>
      )}
      {taskId ? <div className="video-meta-line">任务 ID：{taskId}</div> : null}
      {errorMessage ? <div className="video-error">{errorMessage}</div> : null}
    </>
  );
}
