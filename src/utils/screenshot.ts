import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface ScreenshotInfo {
  path: string;
  timestamp: number;
  index: number;
}

interface ScreenshotOptions {
  screenshotCount?: number; // Default: 4
  format?: string; // Default: 'jpg'
  quality?: number; // Default: 100
  outputDir?: string; // Default: OS temp directory
}

export async function extractVideoScreenshots(
  inputFile: string,
  options: ScreenshotOptions = {}
): Promise<ScreenshotInfo[]> {
  // Set default options
  const {
    screenshotCount = 4,
    format = "jpg",
    quality = 100,
    outputDir = path.join(os.tmpdir(), `video_screenshots_${Date.now()}`),
  } = options;

  // Validate input file exists
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get video duration
  const duration = await getFileDuration(inputFile);
  const baseFileName = path.basename(inputFile, path.extname(inputFile));
  const screenshots: ScreenshotInfo[] = [];
  const processingPromises: Promise<void>[] = [];

  // Calculate timestamps for screenshots (evenly distributed)
  // Start at 1% and end at 99% of duration to avoid black frames
  const startTime = duration * 0.01;
  const endTime = duration * 0.99;
  const interval = (endTime - startTime) / (screenshotCount - 1);

  for (let i = 0; i < screenshotCount; i++) {
    const timestamp = startTime + interval * i;
    const screenshotPath = path.join(
      outputDir,
      `${baseFileName}_screenshot_${i}.${format}`
    );

    // Only process if screenshot doesn't exist
    if (!fs.existsSync(screenshotPath)) {
      processingPromises.push(
        extractScreenshot(inputFile, screenshotPath, timestamp, format, quality)
      );
    }

    screenshots.push({
      path: screenshotPath,
      timestamp,
      index: i,
    });
  }

  // Wait for all screenshots to be processed
  await Promise.all(processingPromises);

  return screenshots;
}

function getFileDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

function extractScreenshot(
  inputPath: string,
  outputPath: string,
  timestamp: number,
  format: string,
  quality: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: "1280x720", // HD resolution
        quality,
      })
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });
}

// Example usage:
/*
const screenshots = await extractVideoScreenshots('input.mp4', {
  screenshotCount: 6,         // Optional: Get 6 screenshots instead of default 4
  format: 'png',              // Optional: Use PNG format instead of JPG
  quality: 90,                // Optional: Slightly lower quality (1-100)
  outputDir: './thumbnails'   // Optional: Custom output directory
});

console.log('Generated screenshots:', screenshots);
*/
