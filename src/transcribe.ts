import path from "path";
import fs from "fs";
import { generateDescription, GenerateDescriptionResult } from "./describe";
import { generateWithGemini } from "./utils/gemini";
import { TRANSCRIPTION_PROMPT } from "./prompts";
import { sanitizeFileName } from "./utils/sanitize";

interface TranscriptionOptions {
  transcriptionModel: string;
  outputPath?: string;
  showProgress?: boolean;
  userInstructions?: string;
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

// New function to generate deterministic metadata
function generateMetadata(
  inputFile: string,
  userInstructions?: string
): string {
  // Get file stats for creation and modification times
  const stats = fs.statSync(inputFile);
  const creationTime = stats.birthtime;
  const modificationTime = stats.mtime;

  // Get current time for processing timestamp
  const processingTime = new Date();

  // Format dates in a clean, consistent format
  const formatDate = (date: Date): string => {
    return date.toISOString().replace("T", " ").substring(0, 19);
  };

  // Generate metadata block
  return `# File Metadata
- **Filename:** ${path.basename(inputFile)}
- **File Created:** ${formatDate(creationTime)}
- **File Modified:** ${formatDate(modificationTime)}
- **Processing Date:** ${formatDate(processingTime)}
- **File Size:** ${(stats.size / (1024 * 1024)).toFixed(2)} MB
- **File Path:** ${inputFile}${
    userInstructions
      ? `
- **User Instructions:** ${userInstructions}`
      : ""
  }

*Note: This metadata is generated from the file properties and may not reflect the actual date/time when the content was recorded.*
`;
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
  } = options;

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // Determine the intermediates directory (should have been created in the describe step)
  const intermediatesDir =
    descriptionResult.generatedFiles.intermediateOutputPath ||
    path.join(outputPath, ".offmute");

  // Create intermediates directory if it doesn't exist
  if (!fs.existsSync(intermediatesDir)) {
    fs.mkdirSync(intermediatesDir, { recursive: true });
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

  // Save config.json in the intermediates directory
  const configPath = path.join(intermediatesDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(configOutput, null, 2));

  const chunks = descriptionResult.generatedFiles.audioChunks;
  const chunkCount = chunks.length;
  const chunkTranscriptions: string[] = [];

  // Initialize progress tracking if needed
  if (showProgress) {
    console.log(`Starting transcription of ${chunkCount} chunks...`);
  }

  // Create transcription directory within the intermediates folder
  const transcriptionDir = path.join(intermediatesDir, "transcription");
  if (!fs.existsSync(transcriptionDir)) {
    fs.mkdirSync(transcriptionDir, { recursive: true });
  }

  // Generate output filename with sanitization
  const inputFileName = path.basename(inputFile, path.extname(inputFile));
  const sanitizedFileName = sanitizeFileName(inputFileName);
  const transcriptionPath = path.join(
    outputPath,
    `${sanitizedFileName}_transcription.md`
  );

  // Generate metadata for the file
  const metadata = generateMetadata(inputFile, userInstructions);

  // Initialize the output file with metadata and headers
  const initialContent = [
    metadata,
    "# Meeting Description",
    descriptionResult.finalDescription,
    "\n# Audio Analysis",
    descriptionResult.audioDescription,
    "\n# Visual Analysis",
    descriptionResult.imageDescription,
    "\n# Full Transcription",
    "*(Transcription in progress...)*",
  ].join("\n\n");

  // Write initial content to file
  fs.writeFileSync(transcriptionPath, initialContent, "utf-8");

  if (showProgress) {
    console.log(`Initial transcription file created at: ${transcriptionPath}`);
  }

  // Process chunks sequentially to maintain context
  let previousTranscription = "";
  let transcriptionContent = "";

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
        }
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
        const errorText = `\n[Transcription error for chunk ${i + 1}]\n`;
        chunkTranscriptions.push(errorText);
        transcriptionContent += errorText;
      } else {
        // Clean up the transcription text
        let transcriptionText = transcriptionResponse.text.trim();

        // Add spacing between speakers if not present
        transcriptionText = transcriptionText.replace(/~\[/g, "\n\n~[");

        chunkTranscriptions.push(transcriptionText);
        transcriptionContent += (i > 0 ? "\n\n" : "") + transcriptionText;

        previousTranscription = getLastNLines(transcriptionText, 20);
      }

      // Update the transcription file with the latest content
      updateTranscriptionFile(
        transcriptionPath,
        transcriptionContent,
        i + 1,
        chunkCount
      );

      if (showProgress) {
        console.log(
          `Transcription file updated (${i + 1}/${chunkCount} chunks)`
        );
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
      const errorText = `\n[Transcription error for chunk ${i + 1}]\n`;
      chunkTranscriptions.push(errorText);
      transcriptionContent += errorText;

      // Update the transcription file with the error
      updateTranscriptionFile(
        transcriptionPath,
        transcriptionContent,
        i + 1,
        chunkCount
      );
    }
  }

  // Final update to the transcription file
  updateTranscriptionFile(
    transcriptionPath,
    transcriptionContent,
    chunkCount,
    chunkCount,
    true
  );

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

// Helper function to update the transcription file incrementally
function updateTranscriptionFile(
  filePath: string,
  transcriptionContent: string,
  currentChunk: number,
  totalChunks: number,
  isComplete: boolean = false
): void {
  // Read the current file content
  const currentContent = fs.readFileSync(filePath, "utf-8");

  // Find the position where we need to update
  const transcriptionHeaderPos = currentContent.indexOf("# Full Transcription");
  if (transcriptionHeaderPos === -1) return;

  // Create the new content by replacing everything after the transcription header
  const contentBeforeTranscription = currentContent.substring(
    0,
    transcriptionHeaderPos + "# Full Transcription".length
  );

  // Add progress indicator if not complete
  const progressIndicator = isComplete
    ? ""
    : `\n\n*Progress: ${currentChunk}/${totalChunks} chunks processed (${Math.round(
        (currentChunk / totalChunks) * 100
      )}%)*`;

  // Create the new content
  const newContent =
    contentBeforeTranscription +
    progressIndicator +
    "\n\n" +
    transcriptionContent;

  // Write the updated content back to the file
  fs.writeFileSync(filePath, newContent, "utf-8");
}
