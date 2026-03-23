<script lang="ts">
  import { Upload, Image, Video } from "lucide-svelte";
  import type { FileType } from "$lib/types";

  type Props = {
    onFileSelect: (file: File, type: FileType) => void;
  }

  const { onFileSelect }: Props = $props();

  let isDragging = $state(false);
  // eslint-disable-next-line prefer-const
  let fileInput = $state<HTMLInputElement>();

  const ACCEPTED_TYPES: Record<string, FileType> = {
    "image/gif": "image",
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "video/mp4": "video",
    "video/quicktime": "video",
    "video/webm": "video",
    "video/x-msvideo": "video",
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {return;}
    const [file] = files;
    if (!file) {return;}
    const type = ACCEPTED_TYPES[file.type];
    if (type) {
      onFileSelect(file, type);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    isDragging = false;
    handleFiles(e.dataTransfer?.files ?? null);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    isDragging = true;
  };

  const onDragLeave = () => {
    isDragging = false;
  };

  const onInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    handleFiles(target.files);
  };

  const openPicker = () => {
    fileInput?.click();
  };
</script>

<div
  class="upload-zone"
  class:dragging={isDragging}
  role="button"
  tabindex={0}
  ondrop={onDrop}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  onclick={openPicker}
  onkeydown={(e) => e.key === "Enter" && openPicker()}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
    class="hidden"
    onchange={onInputChange}
  />

  <div class="upload-content">
    <div class="upload-icon-ring">
      <Upload size={28} strokeWidth={1.5} />
    </div>

    <div class="upload-text">
      <p class="upload-title">Drop your file here</p>
      <p class="upload-subtitle">or click to browse</p>
    </div>

    <div class="upload-formats">
      <span class="format-tag">
        <Image size={14} />
        PNG, JPG, WebP
      </span>
      <span class="format-tag">
        <Video size={14} />
        MP4, WebM, MOV
      </span>
    </div>
  </div>
</div>

<style>
  .upload-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 2px dashed oklch(0.3 0 0);
    border-radius: 1rem;
    padding: 3rem 2rem;
    cursor: pointer;
    transition: all 0.2s ease;
    background: oklch(0.12 0 0);
    min-height: 300px;
  }

  .upload-zone:hover,
  .upload-zone.dragging {
    border-color: oklch(0.65 0.15 155);
    background: oklch(0.14 0.01 155);
  }

  .upload-zone.dragging {
    transform: scale(1.01);
  }

  .hidden {
    display: none;
  }

  .upload-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
  }

  .upload-icon-ring {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: oklch(0.18 0 0);
    border: 1px solid oklch(0.25 0 0);
    color: oklch(0.7 0 0);
    transition: all 0.2s ease;
  }

  .upload-zone:hover .upload-icon-ring {
    background: oklch(0.2 0.02 155);
    border-color: oklch(0.65 0.15 155);
    color: oklch(0.75 0.15 155);
  }

  .upload-text {
    text-align: center;
  }

  .upload-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: oklch(0.9 0 0);
    margin-bottom: 0.25rem;
  }

  .upload-subtitle {
    font-size: 0.875rem;
    color: oklch(0.55 0 0);
  }

  .upload-formats {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .format-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: oklch(0.55 0 0);
    background: oklch(0.16 0 0);
    padding: 0.375rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid oklch(0.22 0 0);
  }
</style>
