import { type CSSProperties } from "react";
import { formatSeconds } from "../lib/utils";

const MAX_CLIP_DURATION = 3;

interface ClipSelectorProps {
  duration: number | null;
  start: number | null;
  end: number | null;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onSetStartFromCurrent?: () => void;
  onSetEndFromCurrent?: () => void;
  disabled?: boolean;
  showSetCurrentButtons?: boolean;
}

export function ClipSelector({
  duration,
  start,
  end,
  onStartChange,
  onEndChange,
  onSetStartFromCurrent,
  onSetEndFromCurrent,
  disabled = false,
  showSetCurrentButtons = false,
}: ClipSelectorProps) {
  const clipDuration = start !== null && end !== null ? end - start : null;
  const clipTooLong = clipDuration !== null && clipDuration > MAX_CLIP_DURATION;
  const clipInvalid = clipDuration !== null && clipDuration <= 0;
  
  const timelineMax = duration ?? 0;
  const timelineStart = start ?? 0;
  const timelineEnd = end ?? Math.min(MAX_CLIP_DURATION, timelineMax);
  
  const startPercent = timelineMax > 0 ? (timelineStart / timelineMax) * 100 : 0;
  const endPercent = timelineMax > 0 ? (timelineEnd / timelineMax) * 100 : 0;
  
  const timelineStyle: CSSProperties = {
    ["--range-start" as any]: `${startPercent}%`,
    ["--range-end" as any]: `${endPercent}%`,
  };
  
  const clipLabel =
    clipDuration === null
      ? "请选择 0-3 秒范围"
      : clipInvalid
      ? "结束时间需大于开始时间"
      : clipTooLong
      ? "截取范围超过 3 秒"
      : `已选择 ${clipDuration.toFixed(2)} 秒`;

  return (
    <div className="character-trim">
      <div className="character-trim-caption">拖动时间线选择范围</div>
      
      {timelineMax > 0 && (
        <>
          <div className="character-timeline" style={timelineStyle}>
            <input
              className="character-range start"
              type="range"
              min={0}
              max={timelineMax}
              step="0.1"
              value={timelineStart}
              onChange={(event) => onStartChange(event.target.value)}
              disabled={disabled || timelineMax <= 0}
            />
            <input
              className="character-range end"
              type="range"
              min={0}
              max={timelineMax}
              step="0.1"
              value={timelineEnd}
              onChange={(event) => onEndChange(event.target.value)}
              disabled={disabled || timelineMax <= 0}
            />
          </div>
          
          <div className="character-timeline-labels">
            <span>0s</span>
            <span>{formatSeconds(timelineMax)}s</span>
          </div>
        </>
      )}

      <div className="character-trim-row">
        <label htmlFor="start">开始 (秒)</label>
        <input
          id="start"
          type="number"
          min={0}
          step="0.1"
          value={start ?? ""}
          onChange={(event) => onStartChange(event.target.value)}
          disabled={disabled}
        />
        {showSetCurrentButtons && onSetStartFromCurrent && (
          <button
            className="character-trim-button"
            type="button"
            onClick={onSetStartFromCurrent}
            disabled={disabled}
          >
            取当前
          </button>
        )}
      </div>

      <div className="character-trim-row">
        <label htmlFor="end">结束 (秒)</label>
        <input
          id="end"
          type="number"
          min={0}
          step="0.1"
          value={end ?? ""}
          onChange={(event) => onEndChange(event.target.value)}
          disabled={disabled}
        />
        {showSetCurrentButtons && onSetEndFromCurrent && (
          <button
            className="character-trim-button"
            type="button"
            onClick={onSetEndFromCurrent}
            disabled={disabled}
          >
            取当前
          </button>
        )}
      </div>

      <div
        className={`character-trim-meta${clipTooLong || clipInvalid ? " error" : ""}`}
      >
        {clipLabel}
        {duration !== null ? (
          <span> · 视频时长 {formatSeconds(duration)} 秒</span>
        ) : null}
      </div>
    </div>
  );
}
