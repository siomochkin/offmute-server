import path from "path";
import fs from "fs";
import { generateDescription, GenerateDescriptionResult } from "./describe";
import { generateWithGemini } from "./utils/gemini";
import { TRANSCRIPTION_PROMPT } from "./prompts";

interface TranscriptionOptions {
  transcriptionModel: string;
  outputPath?: string;
  showProgress?: boolean;
  userInstructions?: string;
  apiKey?: string;
}

interface TranscriptionResult {
  transcriptionPath: string;
  chunkTranscriptions: string[];
  intermediateOutputPath?: string;
}

interface TranscriptionChunkOutput {
  timestamp: number;
  chunkIndex: number;
  prompt: string;
  response: string;
  error?: string;
}

async function saveTranscriptionOutput(
  outputPath: string,
  data: TranscriptionChunkOutput
): Promise<void> {
  const outputFile = path.join(outputPath, "transcription_progress.json");
  const existingData: TranscriptionChunkOutput[] = [];

  // Read existing data if it exists
  if (fs.existsSync(outputFile)) {
    try {
      const content = fs.readFileSync(outputFile, "utf8");
      Object.assign(existingData, JSON.parse(content));
    } catch (error) {
      console.warn("Error reading transcription progress file:", error);
    }
  }

  // Add or update chunk data
  const existingIndex = existingData.findIndex(
    (item) => item.chunkIndex === data.chunkIndex
  );

  if (existingIndex >= 0) {
    existingData[existingIndex] = data;
  } else {
    existingData.push(data);
  }

  // Sort by chunk index
  existingData.sort((a, b) => a.chunkIndex - b.chunkIndex);

  // Save updated data
  fs.writeFileSync(outputFile, JSON.stringify(existingData, null, 2));
}

// Helper function to get last N lines of text
function getLastNLines(text: string, n: number): string {
  if (!text) return "";
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.slice(-n).join("\n");
}

export async function generateTranscription(
  inputFile: string,
  descriptionResult: GenerateDescriptionResult,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  const {
    transcriptionModel,
    outputPath = path.dirname(inputFile),
    showProgress = false,
    userInstructions,
    apiKey,
  } = options;

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // Save initial prompt templates and configuration
  const configOutput = {
    timestamp: Date.now(),
    inputFile,
    model: transcriptionModel,
    description: descriptionResult.finalDescription,
    audioDescription: descriptionResult.audioDescription,
    imageDescription: descriptionResult.imageDescription,
    chunkCount: descriptionResult.generatedFiles.audioChunks.length,
  };

  // Save config.json in the main intermediates directory
  const configPath = path.join(
    descriptionResult.generatedFiles.intermediateOutputPath || outputPath,
    "config.json"
  );

  fs.writeFileSync(configPath, JSON.stringify(configOutput, null, 2));

  const chunks = descriptionResult.generatedFiles.audioChunks;
  const chunkCount = chunks.length;
  const chunkTranscriptions: string[] = [];

  // Initialize progress tracking if needed
  if (showProgress) {
    console.log(`Starting transcription of ${chunkCount} chunks...`);
  }

  // Create transcription directory in the same intermediates folder
  const transcriptionDir = path.join(
    descriptionResult.generatedFiles.intermediateOutputPath || outputPath,
    "transcription"
  );
  if (!fs.existsSync(transcriptionDir)) {
    fs.mkdirSync(transcriptionDir, { recursive: true });
  }

  // Process chunks sequentially to maintain context
  let previousTranscription = "";
  for (let i = 0; i < chunkCount; i++) {
    if (showProgress) {
      console.log(`Processing chunk ${i + 1}/${chunkCount}`);
    }

    const chunk = chunks[i];
    const prompt = TRANSCRIPTION_PROMPT(
      descriptionResult.finalDescription,
      i + 1,
      chunkCount,
      previousTranscription,
      userInstructions
    );

    try {
      const transcriptionResponse = await generateWithGemini(
        transcriptionModel,
        prompt,
        [{ path: chunk }],
        {
          maxRetries: 3,
          temperature: 0.2, // Lower temperature for more consistent transcription
        },
        apiKey
      );

      // Save chunk progress including prompt and response
      await saveTranscriptionOutput(transcriptionDir, {
        timestamp: Date.now(),
        chunkIndex: i,
        prompt,
        response: transcriptionResponse.text,
        error: transcriptionResponse.error,
      });

      if (transcriptionResponse.error) {
        console.error(
          `Error transcribing chunk ${i + 1}:`,
          transcriptionResponse.error
        );
        chunkTranscriptions.push(
          `\n[Transcription error for chunk ${i + 1}]\n`
        );
      } else {
        // Clean up the transcription text
        let transcriptionText = transcriptionResponse.text.trim();

        // Add spacing between speakers if not present
        transcriptionText = transcriptionText.replace(/~\[/g, "\n\n~[");

        chunkTranscriptions.push(transcriptionText);

        previousTranscription = getLastNLines(transcriptionText, 20);
      }
    } catch (error) {
      console.error(`Failed to transcribe chunk ${i + 1}:`, error);
      await saveTranscriptionOutput(transcriptionDir, {
        timestamp: Date.now(),
        chunkIndex: i,
        prompt,
        response: "",
        error: error instanceof Error ? error.message : String(error),
      });
      chunkTranscriptions.push(`\n[Transcription error for chunk ${i + 1}]\n`);
    }
  }

  // Combine all content into a single document with proper spacing
  const combinedContent = [
    "# Meeting Description",
    descriptionResult.finalDescription,
    "\n# Audio Analysis",
    descriptionResult.audioDescription,
    "\n# Visual Analysis",
    descriptionResult.imageDescription,
    "\n# Full Transcription",
    ...chunkTranscriptions.map((chunk) => chunk.trim()), // Trim each chunk
  ].join("\n\n");

  // Generate output filenames
  const inputFileName = path.basename(inputFile, path.extname(inputFile));
  const transcriptionPath = path.join(
    outputPath,
    `${inputFileName}_transcription.md`
  );

  // Save the combined content
  fs.writeFileSync(transcriptionPath, combinedContent, "utf-8");

  // Also save raw transcriptions separately
  fs.writeFileSync(
    path.join(transcriptionDir, "raw_transcriptions.json"),
    JSON.stringify(chunkTranscriptions, null, 2)
  );

  if (showProgress) {
    console.log(`Transcription complete. Saved to: ${transcriptionPath}`);
    console.log(`Intermediate outputs saved in: ${transcriptionDir}`);
  }

  return {
    transcriptionPath,
    chunkTranscriptions,
    intermediateOutputPath: transcriptionDir,
  };
}
