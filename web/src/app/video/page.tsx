"use client";

import Link from "next/link";
import { VideoGenerator } from "@/components/VideoGenerator";
import { CharacterUploader } from "@/components/CharacterUploader";

export default function VideoPage() {
  const handleCharacterComplete = (characterId: string) => {
    console.log("Character created:", characterId);
  };

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

        <VideoGenerator />

        <div className="video-card full">
          <div className="video-card-header">
            <div>
              <div className="video-card-title">角色上传</div>
              <div className="video-card-subtitle">上传视频并截取 0-3 秒创建角色</div>
            </div>
          </div>
          <div className="character-hint">生成后可在提示词中 @角色ID 使用</div>

          <CharacterUploader
            label="上传视频创建角色"
            description="支持从视频中截取 3 秒"
            apiEndpoint="/api/video/character"
            getFormData={(file: File, start: number, end: number) => {
              const formData = new FormData();
              formData.append("video", file);
              formData.append("timestamps", `${start.toFixed(2)},${end.toFixed(2)}`);
              return formData;
            }}
            onComplete={handleCharacterComplete}
          />
        </div>
      </div>
    </div>
  );
}
