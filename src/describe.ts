import path from "path";
import fs from "fs";
import { processAudioFile } from "./utils/audio-chunk";
import { extractVideoScreenshots } from "./utils/screenshot";
import { generateWithGemini } from "./utils/gemini";
import {
  AUDIO_DESC_PROMPT,
  IMAGE_DESC_PROMPT,
  MERGE_DESC_PROMPT,
} from "./prompts";
import { SingleBar, Presets, MultiBar } from "cli-progress";
import { isVideoFile } from "./utils/check-type";

interface GenerateDescriptionOptions {
  screenshotModel: string;
  screenshotCount?: number;
  audioModel: string;
  descriptionChunkMinutes?: number;
  transcriptionChunkMinutes?: number;
  mergeModel: string;
  outputPath?: string;
  showProgress?: boolean;
}

export interface GenerateDescriptionResult {
  imageDescription?: string;
  audioDescription?: string;
  finalDescription: string;
  generatedFiles: {
    screenshots: string[];
    audioChunks: string[];
    intermediateOutputPath?: string;
  };
}

interface IntermediateOutput {
  timestamp: number;
  prompt?: string;
  imageDescription?: string;
  audioDescription?: string;
  finalDescription?: string;
  error?: string;
}

async function saveIntermediateOutput(
  outputPath: string | undefined,
  data: Partial<IntermediateOutput>
): Promise<void> {
  if (!outputPath) return;

  const outputFile = path.join(outputPath, "intermediate_output.json");
  const timestamp = Date.now();

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // Read existing data if it exists
  let existingData: IntermediateOutput[] = [];
  if (fs.existsSync(outputFile)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    } catch (error) {
      console.warn("Error reading intermediate output file:", error);
    }
  }

  // Add new data
  existingData.push({
    timestamp,
    ...data,
  });

  // Save updated data
  fs.writeFileSync(outputFile, JSON.stringify(existingData, null, 2));
}

export async function generateDescription(
  inputFile: string,
  options: GenerateDescriptionOptions
): Promise<GenerateDescriptionResult> {
  const {
    screenshotModel,
    screenshotCount = 4,
    audioModel,
    descriptionChunkMinutes = 20,
    transcriptionChunkMinutes = 10,
    mergeModel,
    outputPath,
    showProgress = false,
  } = options;

  // Initialize progress bars if needed
  let multibar: MultiBar | undefined;
  let screenshotBar: SingleBar | undefined;
  let audioBar: SingleBar | undefined;
  let processingBar: SingleBar | undefined;

  if (showProgress) {
    multibar = new MultiBar(
      {
        format: "{bar} | {percentage}% | {task}",
        hideCursor: true,
      },
      Presets.shades_classic
    );

    // Only create progress bars for relevant operations
    if (isVideoFile(inputFile)) {
      screenshotBar = multibar.create(100, 0, { task: "Screenshots" });
    }
    audioBar = multibar.create(100, 0, { task: "Audio Processing" });
    processingBar = multibar.create(100, 0, { task: "AI Processing" });
  }

  try {
    // Determine which operations to run based on file type
    const isVideo = isVideoFile(inputFile);

    // Start parallel processing of screenshots (if video) and audio
    const [screenshotResult, audioResult] = await Promise.all([
      // Generate screenshots only if it's a video file
      isVideo
        ? extractVideoScreenshots(inputFile, {
            screenshotCount,
            outputDir: outputPath
              ? path.join(outputPath, "screenshots")
              : undefined,
          }).then(async (screenshots) => {
            if (screenshotBar) screenshotBar.update(50);

            const imageDescription = await generateWithGemini(
              screenshotModel,
              IMAGE_DESC_PROMPT(screenshots.map((s) => s.path).join(", ")),
              screenshots.map((s) => ({ path: s.path }))
            );

            if (screenshotBar) screenshotBar.update(100);

            await saveIntermediateOutput(outputPath, {
              imageDescription: imageDescription.text,
            });

            return {
              description: imageDescription.text,
              files: screenshots.map((s) => s.path),
            };
          })
        : Promise.resolve({ description: "", files: [] }),

      // Process audio
      processAudioFile(inputFile, {
        chunkMinutes: transcriptionChunkMinutes,
        tagMinutes: descriptionChunkMinutes,
        outputDir: outputPath ? path.join(outputPath, "audio") : undefined,
      }).then(async (chunks) => {
        if (audioBar) audioBar.update(50);

        const audioDescription = await generateWithGemini(
          audioModel,
          AUDIO_DESC_PROMPT(path.basename(inputFile)),
          [{ path: chunks.tagSample }]
        );

        if (audioBar) audioBar.update(100);

        await saveIntermediateOutput(outputPath, {
          audioDescription: audioDescription.text,
        });

        return {
          description: audioDescription.text,
          files: chunks.chunks.map((c) => c.path),
        };
      }),
    ]);

    if (processingBar) processingBar.update(50);

    // Adjust merge prompt based on available descriptions
    const descriptionsToMerge = isVideo
      ? [screenshotResult.description, audioResult.description]
      : [audioResult.description];

    const finalDescription = await generateWithGemini(
      mergeModel,
      MERGE_DESC_PROMPT(descriptionsToMerge),
      []
    );

    if (processingBar) processingBar.update(100);

    await saveIntermediateOutput(outputPath, {
      prompt: MERGE_DESC_PROMPT(descriptionsToMerge),
      finalDescription: finalDescription.text,
    });

    // Clean up progress bars
    if (multibar) {
      multibar.stop();
    }

    return {
      imageDescription: isVideo ? screenshotResult.description : undefined,
      audioDescription: audioResult.description,
      finalDescription: finalDescription.text,
      generatedFiles: {
        screenshots: screenshotResult.files,
        audioChunks: audioResult.files,
        intermediateOutputPath: outputPath,
      },
    };
  } catch (error) {
    // Save error state if output path is provided
    if (outputPath) {
      await saveIntermediateOutput(outputPath, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Clean up progress bars
    if (multibar) {
      multibar.stop();
    }

    throw error;
  }
}

// Example usage:
// const result = await generateDescription(
//   __dirname + "/../tests/data/speech.mp3",
//   {
//     screenshotModel: "gemini-1.5-flash-8b",
//     screenshotCount: 6,
//     audioModel: "gemini-1.5-flash-8b",
//     descriptionChunkMinutes: 20,
//     transcriptionChunkMinutes: 1,
//     mergeModel: "gemini-1.5-flash-8b",
//     outputPath: __dirname + "/../tests/description_tests",
//     showProgress: true,
//   }
// );

// console.log("Final Description:", result.finalDescription);
