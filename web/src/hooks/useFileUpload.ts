import { ChangeEvent, DragEvent, useRef, useState } from "react";

export function useFileUpload(accept: string, multiple: boolean = false) {
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const revokeObjectUrls = (urls: string[]) => {
    urls.forEach((url) => {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });
  };

  const handleFiles = (incomingFiles: FileList | File[]) => {
    const validFiles = Array.from(incomingFiles).filter((file) =>
      file.type.startsWith(accept.split("/")[0] + "/")
    );
    
    if (validFiles.length === 0) {
      return;
    }

    revokeObjectUrls(previewUrls);
    const nextUrls = validFiles.map((file) => URL.createObjectURL(file));
    setFiles(validFiles);
    setPreviewUrls(nextUrls);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    event.target.value = "";
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  };

  const clearFiles = () => {
    revokeObjectUrls(previewUrls);
    setFiles([]);
    setPreviewUrls([]);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const cleanup = () => {
    revokeObjectUrls(previewUrls);
  };

  return {
    files,
    previewUrls,
    isDragging,
    fileInputRef,
    setFiles,
    setPreviewUrls,
    handleFiles,
    handleInputChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearFiles,
    openFilePicker,
    cleanup,
  };
}
