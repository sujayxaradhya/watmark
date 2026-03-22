export type ToolMode = "brush" | "eraser";

export type FileType = "image" | "video";

export type EditorPhase = "upload" | "editing" | "processing" | "result";

export interface MaskStroke {
  points: { x: number; y: number }[];
  brushSize: number;
  mode: ToolMode;
}

export interface EditorState {
  phase: EditorPhase;
  file: File | null;
  fileType: FileType | null;
  originalUrl: string | null;
  processedUrl: string | null;
  brushSize: number;
  toolMode: ToolMode;
  strokes: MaskStroke[];
  isProcessing: boolean;
  progress: number;
  statusText: string;
  error: string | null;
}

export const createDefaultState = (): EditorState => ({
  brushSize: 20,
  error: null,
  file: null,
  fileType: null,
  isProcessing: false,
  originalUrl: null,
  phase: "upload",
  processedUrl: null,
  progress: 0,
  statusText: "",
  strokes: [],
  toolMode: "brush",
});
