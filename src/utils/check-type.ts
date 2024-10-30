import path from "path";

// First, add the file type checking functions
export function isVideoFile(filePath: string): boolean {
  const videoExtensions = new Set([
    ".flv",
    ".mov",
    ".mpeg",
    ".mpegps",
    ".mpg",
    ".mp4",
    ".webm",
    ".wmv",
    ".3gpp",
  ]);
  return videoExtensions.has(path.extname(filePath).toLowerCase());
}

export function isAudioFile(filePath: string): boolean {
  const audioExtensions = new Set([
    ".aac",
    ".flac",
    ".mp3",
    ".m4a",
    ".mpa",
    ".mpga",
    ".opus",
    ".pcm",
    ".wav",
  ]);
  return audioExtensions.has(path.extname(filePath).toLowerCase());
}
