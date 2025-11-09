import { generateWithGemini } from "./utils/gemini";
import {
  REPORT_HEADINGS_JSONSCHEMA,
  REPORT_HEADINGS_PROMPT,
  REPORT_SECTION_GENERATION_PROMPT,
  ReportHeadings,
  ReportSection,
} from "./prompts";
import path from "path";
import fs from "fs";
import { sanitizeFileName } from "./utils/sanitize";

interface GenerateReportOptions {
  model: string;
  outputPath: string;
  reportName: string;
  showProgress?: boolean;
  userInstructions?: string;
}

export interface GenerateReportResult {
  reportPath: string;
  sections: ReportSection[];
  intermediateOutputPath: string;
}

interface ReportGenerationOutput {
  timestamp: number;
  step: string;
  data: any;
  prompt?: string;
  error?: string;
}

function isValidSectionContent(content: string): boolean {
  // Check if content appears to be JSON
  if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
    try {
      JSON.parse(content);
      return false; // If it parses as JSON, it's not valid section content
    } catch {
      // If it doesn't parse as JSON, continue with other checks
    }
  }

  // Check if content is too short or empty
  if (content.trim().length < 10) {
    return false;
  }

  // Check if content appears to be just headings
  const contentLines = content.trim().split("\n");
  if (
    contentLines.every((line) => line.startsWith("#") || line.trim() === "")
  ) {
    return false;
  }

  return true;
}

async function saveReportOutput(
  outputPath: string,
  data: Partial<ReportGenerationOutput>
): Promise<void> {
  const outputFile = path.join(outputPath, "report_generation.json");
  const timestamp = Date.now();

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // Read existing data if it exists
  let existingData: ReportGenerationOutput[] = [];
  if (fs.existsSync(outputFile)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    } catch (error) {
      console.warn("Error reading report generation file:", error);
    }
  }

  // Add new data
  existingData.push({
    timestamp,
    ...data,
  } as ReportGenerationOutput);

  // Save updated data
  fs.writeFileSync(outputFile, JSON.stringify(existingData, null, 2));
}

// New function to generate deterministic metadata
function generateMetadata(
  reportName: string,
  outputPath: string,
  userInstructions?: string
): string {
  // Get current time for processing timestamp
  const processingTime = new Date();

  // Format date in a clean, consistent format
  const formatDate = (date: Date): string => {
    return date.toISOString().replace("T", " ").substring(0, 19);
  };

  // Generate metadata block
  return `# File Metadata
- **Report Name:** ${reportName}
- **Report Generated:** ${formatDate(processingTime)}
- **Report Path:** ${path.join(outputPath, `${reportName}.md`)}${
    userInstructions
      ? `
- **User Instructions:** ${userInstructions}`
      : ""
  }

*Note: This metadata is generated from the file properties when the report was created.*
`;
}

// Helper function to update the report with structure (just titles)
function updateReportStructure(
  filePath: string,
  headings: ReportHeadings
): void {
  // Read the current file content
  const currentContent = fs.readFileSync(filePath, "utf-8");

  // Find the position after the title
  const titlePos = currentContent.indexOf("# Meeting Report");
  if (titlePos === -1) return;

  // Create section placeholders
  const sectionPlaceholders = headings.sections
    .map((section) => `## ${section.title}\n\n*(Content being generated...)*`)
    .join("\n\n");

  // Create the new content
  const newContent =
    currentContent.substring(0, titlePos + "# Meeting Report".length) +
    "\n\n" +
    `*Report structure created. Generating content for ${headings.sections.length} sections...*` +
    "\n\n" +
    sectionPlaceholders;

  // Write the updated content back to the file
  fs.writeFileSync(filePath, newContent, "utf-8");
}

// Helper function to update a specific section in the report
function updateReportSection(
  filePath: string,
  sectionTitle: string,
  sectionContent: string,
  currentSection: number,
  totalSections: number
): void {
  // Read the current file content
  const currentContent = fs.readFileSync(filePath, "utf-8");

  // Find the section to update
  const sectionHeaderPos = currentContent.indexOf(`## ${sectionTitle}`);
  if (sectionHeaderPos === -1) return;

  // Find the end of this section (next section header or end of file)
  let nextSectionPos = currentContent.indexOf("## ", sectionHeaderPos + 3);
  if (nextSectionPos === -1) {
    nextSectionPos = currentContent.length;
  }

  // Create the new content
  const newContent =
    currentContent.substring(
      0,
      sectionHeaderPos + `## ${sectionTitle}`.length
    ) +
    "\n\n" +
    sectionContent +
    "\n\n" +
    currentContent.substring(nextSectionPos);

  // Add progress indicator after title
  const titlePos = newContent.indexOf("# Meeting Report");
  const progressIndicator = `\n\n*Progress: ${currentSection}/${totalSections} sections completed (${Math.round(
    (currentSection / totalSections) * 100
  )}%)*`;

  // Find position to insert progress indicator
  const afterTitlePos = titlePos + "# Meeting Report".length;

  // Insert progress indicator after title
  const contentWithProgress =
    newContent.substring(0, afterTitlePos) +
    progressIndicator +
    newContent.substring(afterTitlePos);

  // Write the updated content back to the file
  fs.writeFileSync(filePath, contentWithProgress, "utf-8");
}

// Helper function to finalize the report by removing progress indicators
function finalizeReport(filePath: string): void {
  // Read the current file content
  const currentContent = fs.readFileSync(filePath, "utf-8");

  // Remove progress indicators and "being generated" messages
  let finalContent = currentContent.replace(/\*Progress: .*?\*\n\n/g, "");
  finalContent = finalContent.replace(
    /\*Report structure created.*?\*\n\n/g,
    ""
  );
  finalContent = finalContent.replace(
    /\*\(Content being generated\.\.\.\)\*/g,
    ""
  );
  finalContent = finalContent.replace(
    /\*\(Report generation in progress\.\.\.\)\*/g,
    ""
  );

  // Clean up any double newlines that might have been created
  finalContent = finalContent.replace(/\n\n\n+/g, "\n\n");

  // Write the final content back to the file
  fs.writeFileSync(filePath, finalContent, "utf-8");
}

export async function generateReport(
  descriptions: string,
  transcript: string,
  options: GenerateReportOptions
): Promise<GenerateReportResult> {
  const {
    model,
    outputPath,
    reportName,
    showProgress = false,
    userInstructions,
  } = options;

  // Sanitize the report name to ensure it's filesystem-safe
  const sanitizedReportName = sanitizeFileName(reportName);

  // Create hidden intermediates directory
  const intermediatesDir = path.join(outputPath, ".offmute");
  if (!fs.existsSync(intermediatesDir)) {
    fs.mkdirSync(intermediatesDir, { recursive: true });
  }

  // Create report intermediates directory under .offmute
  const reportDir = path.join(intermediatesDir, "report");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Generate the report file path with sanitized name
  const reportPath = path.join(outputPath, `${sanitizedReportName}.md`);

  try {
    if (showProgress) {
      console.log("Generating report structure...");
    }

    // Generate metadata for the report
    const metadata = generateMetadata(
      sanitizedReportName,
      outputPath,
      userInstructions
    );

    // Initialize the report file with metadata and title
    const initialContent = [
      metadata,
      "# Meeting Report",
      "\n*(Report generation in progress...)*",
    ].join("\n\n");

    // Write initial content to file
    fs.writeFileSync(reportPath, initialContent, "utf-8");

    if (showProgress) {
      console.log(`Initial report file created at: ${reportPath}`);
    }

    // Save initial prompts
    const headingsPrompt = REPORT_HEADINGS_PROMPT(
      descriptions,
      transcript,
      userInstructions
    );
    await saveReportOutput(reportDir, {
      step: "initial_prompt",
      prompt: headingsPrompt,
      data: {
        descriptions,
        transcript,
        userInstructions,
      },
    });

    // First, generate the report structure
    const headingsResponse = await generateWithGemini(
      model,
      headingsPrompt,
      [],
      {
        maxRetries: 3,
        temperature: 0.2,
        schema: REPORT_HEADINGS_JSONSCHEMA,
      }
    );

    if (headingsResponse.error) {
      throw new Error(
        `Failed to generate report structure: ${headingsResponse.error}`
      );
    }

    await saveReportOutput(reportDir, {
      step: "generate_structure",
      data: headingsResponse.text,
    });

    const headings: ReportHeadings = JSON.parse(headingsResponse.text);

    if (showProgress) {
      console.log(`Generating ${headings.sections.length} sections...`);
    }

    // Update the report with the structure (section titles)
    updateReportStructure(reportPath, headings);

    // Generate content for each section
    const sectionContents: string[] = [];
    for (let i = 0; i < headings.sections.length; i++) {
      const section = headings.sections[i];

      if (showProgress) {
        console.log(
          `Processing section ${i + 1}/${headings.sections.length}: ${
            section.title
          }`
        );
      }

      try {
        const sectionPrompt = REPORT_SECTION_GENERATION_PROMPT(
          headings,
          section,
          transcript,
          descriptions,
          userInstructions
        );

        // Save section prompt
        await saveReportOutput(reportDir, {
          step: "section_prompt",
          prompt: sectionPrompt,
          data: {
            sectionTitle: section.title,
            sectionIndex: i,
          },
        });

        const sectionResponse = await generateWithGemini(
          model,
          sectionPrompt,
          [],
          {
            maxRetries: 3,
            temperature: 0.3,
          }
        );

        let sectionContent = "";

        if (
          sectionResponse.error ||
          !isValidSectionContent(sectionResponse.text)
        ) {
          console.warn(
            `Warning: Error or invalid content for section ${section.title}: ${
              sectionResponse.error || "Invalid content format"
            }`
          );

          // Retry once with a more explicit prompt if content was invalid
          if (
            !sectionResponse.error &&
            !isValidSectionContent(sectionResponse.text)
          ) {
            const retryPrompt = `${sectionPrompt}\n\nPlease provide the content for this section in plain text format, not as JSON or outline. Write it as a narrative paragraph.`;

            const retryResponse = await generateWithGemini(
              model,
              retryPrompt,
              [],
              {
                maxRetries: 2,
                temperature: 0.3,
              }
            );

            if (
              !retryResponse.error &&
              isValidSectionContent(retryResponse.text)
            ) {
              sectionContent = retryResponse.text;
              sectionContents.push(
                `## ${section.title}\n\n${retryResponse.text}`
              );
            } else {
              sectionContent = "*Error generating content*";
              sectionContents.push(
                `## ${section.title}\n\n*Error generating content*`
              );
            }
          } else {
            sectionContent = "*Error generating content*";
            sectionContents.push(
              `## ${section.title}\n\n*Error generating content*`
            );
          }
        } else {
          sectionContent = sectionResponse.text;
          sectionContents.push(
            `## ${section.title}\n\n${sectionResponse.text}`
          );
        }

        // Update the report file with the new section
        updateReportSection(
          reportPath,
          section.title,
          sectionContent,
          i + 1,
          headings.sections.length
        );

        await saveReportOutput(reportDir, {
          step: "generate_section",
          data: {
            section: section.title,
            content: sectionResponse.text,
            error: sectionResponse.error,
          },
        });
      } catch (error) {
        console.warn(
          `Warning: Failed to generate section ${section.title}:`,
          error
        );
        sectionContents.push(
          `## ${section.title}\n\n*Error generating content*`
        );

        // Update the report file with the error
        updateReportSection(
          reportPath,
          section.title,
          "*Error generating content*",
          i + 1,
          headings.sections.length
        );
      }
    }

    // Final update to mark completion
    finalizeReport(reportPath);

    if (showProgress) {
      console.log(`Report generation complete. Saved to: ${reportPath}`);
    }

    return {
      reportPath,
      sections: headings.sections,
      intermediateOutputPath: reportDir,
    };
  } catch (error) {
    // Save error state
    await saveReportOutput(reportDir, {
      step: "error",
      error: error instanceof Error ? error.message : String(error),
      data: null,
    });

    throw error;
  }
}
