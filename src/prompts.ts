// prettier-ignore
export const AUDIO_DESC_PROMPT = (fileName: string, userInstructions?: string) =>
`Describe this audio in two paragraphs with the following information:

1. What are the key topics of discussion?
2. Who are the people talking to the best of your knowledge? Describe them, names if possible at all, and their personalities, job functions, etc. Identify them with speaker 1 and 2 if you don't have names.
3. Summarise this conversation in three sentences, like 'This is a discussion between X (who Y) and X (who Y) about ....'

IMPORTANT: Do NOT guess or include the meeting time, date, or any other metadata that is not explicitly mentioned in the audio. If these details are not clearly stated, do not include them.

${userInstructions ? `USER INSTRUCTIONS: ${userInstructions}\n\n` : ''}File: ${fileName}`

// prettier-ignore
export const IMAGE_DESC_PROMPT = (fileNames: string, userInstructions?: string) =>
`Provided are some screenshots from a meeting. Can you provide the following information from the image (when available)?

1. Who the speakers are (if you can see them), their names, descriptions.
2. General emotions of the people involved.
3. Descriptions of anything else shown on the screen or being shared.
4. Any additional information you can infer about the meeting from the information provided.

IMPORTANT: Do NOT guess or include the meeting time, date, or any other metadata that is not explicitly shown in the images. If these details are not clearly visible, do not include them.

${userInstructions ? `USER INSTRUCTIONS: ${userInstructions}\n\n` : ''}The files are: ${fileNames}`

// prettier-ignore
export const MERGE_DESC_PROMPT = (descriptions: string[], userInstructions?: string) =>
`
Descriptions:
\`\`\`
${descriptions.join("\n\n")}
\`\`\`

Here are the descriptions for a meeting, generated from information (audio/images, etc) about it. Remove conflicting information, use your best judgement to infer what happened, and generate a clean, detailed description for the meeting covering the following:
1. Who the participants of the meeting were. Names if possible.
2. Describe the participants. Appearance if possible, function, emotional state, job, etc.
3. What was discussed? What was shown/covered?
4. If this is not a meeting, provide any additional information that can help describe what this is.

${userInstructions ? `USER INSTRUCTIONS: ${userInstructions}\n\n` : ''}IMPORTANT: Do NOT guess or include the meeting time, date, or location unless these details are explicitly mentioned in the audio or shown in the images. Only include factual information that you can directly observe from the provided content.`

// prettier-ignore
export const TRANSCRIPTION_PROMPT = (description: string, count: number, total: number, previousTranscription: string, userInstructions?: string) =>
`Provided is (${count}/${total}) of the audio of a meeting.

Here is the general description of the meeting:
${description}

${previousTranscription ?
`Here is the transcription from the previous chunk:\n\n...${previousTranscription}\n...` : ""}

Please diarize and transcribe this audio segment with all the speakers identified and named when possible. Add information on emotions, tone, pauses, etc like (silently contemplating, hesitant, etc etc). Format the output as:
~[Speaker Name]~: Transcribed text

${userInstructions ? `USER INSTRUCTIONS: ${userInstructions}\n\n` : ''}${previousTranscription ?
`Continue where the previous transcription left off.` : ""}`

// prettier-ignore
export const REPORT_HEADINGS_PROMPT = (descriptions: string, transcript: string, userInstructions?: string) =>
`Meeting Descriptions:
\`\`\`
${descriptions}
\`\`\`

Transcript:
\`\`\`
${transcript}
\`\`\`

${userInstructions ? `USER INSTRUCTIONS: ${userInstructions}\n\n` : ''}Here are the descriptions and transcript of a meeting or call. We want to turn this into a proper one-pager summary document. Respond with json in this typespec representing the headings and subheadings of the final one-page report, with a one-sentence description. Some things to make sure we cover (in their own section or not) are:
* Useful contacts - companies, people etc
* Action items
* Overall flow of the meeting - what was discussed for how long
* Any arguments or pitches made or things presented
* Participant profiles

Respond with json in this typespec:
\`\`\`typescript
type MeetingSummary = {
  sections: {
    title: string;
    description: string;
    subsections: {
      title: string;
      description: string;
    }[]
  }[];
}
\`\`\``

export type ReportHeadings = {
  sections: ReportSection[];
};

export type ReportSection = {
  title: string;
  description: string;
  subsections: {
    title: string;
    description: string;
  }[];
};

export const REPORT_HEADINGS_JSONSCHEMA = {
  type: "object",
  description: "Meeting report headings and subheadings",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
          },
          description: {
            type: "string",
          },
          subsections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                },
                description: {
                  type: "string",
                },
              },
              required: ["title", "description"],
            },
          },
        },
        required: ["title", "description", "subsections"],
      },
    },
  },
  required: ["sections"],
};

// prettier-ignore
export const REPORT_SECTION_GENERATION_PROMPT = (headings: ReportHeadings, section: ReportSection, transcript: string, descriptions: string, userInstructions?: string) =>
`Meeting Descriptions:
\`\`\`
${descriptions}
\`\`\`

Transcript:
\`\`\`
${transcript}
\`\`\`

${userInstructions ? `USER INSTRUCTIONS: ${userInstructions}\n\n` : ''}Here are the descriptions and transcript of a meeting or call. We want to turn this into a proper one-pager summary document. Respond with json representing the headings and subheadings of the final one-page report.

Here are the main sections we want in the report:
${headings.sections.map((sectionName, index) => `${index + 1}. ${sectionName.title} : ${sectionName.description}`).join("\n")}

We want to write this specific section in markdown:
${section.title}: ${section.description}

Respond with just the content for this section, without title or description or foreword or introduction. Presume the other sections have been written.

Respond in Markdown.
`
