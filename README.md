# npx offmute 🎙️

<div align="center">

[![NPM version](https://img.shields.io/npm/v/offmute.svg)](https://www.npmjs.com/package/offmute)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Intelligent meeting transcription and analysis using Google's Gemini models**

[Features](#-features) • [Quick Start](#-quick-start) • [Installation](#-installation) • [Usage](#-usage) • [Advanced](#-advanced-usage) • [How It Works](#-how-it-works)

</div>

## 🚀 Features

- 🎯 **Transcription & Diarization**: Convert audio/video content to text while identifying different speakers
- 🎭 **Smart Speaker Identification**: Attempts to identify speakers by name and role when possible
- 📊 **Meeting Reports**: Generates structured reports with key points, action items, and participant profiles
- 🎬 **Video Analysis**: Extracts and analyzes visual information from video meetings, understand when demos are beign didsplayed
- ⚡ **Multiple Processing Tiers**: From budget-friendly to premium processing options
- 🔄 **Robust Processing**: Handles long meetings with automatic chunking and proper cleanup
- 📁 **Flexible Output**: Markdown-formatted transcripts and reports with optional intermediate outputs

## 🏃 Quick Start

```bash
# Set your Gemini API key
export GEMINI_API_KEY=your_key_here

# Run on a meeting recording
npx offmute path/to/your/meeting.mp4
```

## 📦 Installation

### As a CLI Tool

```bash
npx offmute <Meeting_Location> <options>
```

### As a Package

```bash
npm install offmute
```

## Get Help

```
npx offmute --help
```

`bunx` or `bun` works faster if you have it!

## 💻 Usage

### Command Line Interface

```bash
npx offmute <input-file> [options]
```

Options:

- `-t, --tier <tier>`: Processing tier (first, business, economy, budget) [default: "business"]
- `-a, --all`: Save all intermediate outputs
- `-sc, --screenshot-count <number>`: Number of screenshots to extract [default: 4]
- `-ac, --audio-chunk-minutes <number>`: Length of audio chunks in minutes [default: 10]
- `-r, --report`: Generate a structured meeting report
- `-rd, --reports-dir <path>`: Custom directory for report output

### Processing Tiers

- **First Tier** (`first`): Uses Gemini 1.5 Pro models for all operations
- **Business Tier** (`business`): Gemini 1.5 Pro for description and report, Gemini 1.5 Flash for transcription
- **Economy Tier** (`economy`): Gemini 1.5 Flash models for all operations
- **Budget Tier** (`budget`): Gemini 1.5 Flash for description, Gemini 2.0 Flash Lite for transcription and report

### As a Module

```typescript
import {
  generateDescription,
  generateTranscription,
  generateReport,
} from "offmute";

// Generate description and transcription
const description = await generateDescription(inputFile, {
  screenshotModel: "gemini-2.0-pro-exp-02-05",
  audioModel: "gemini-2.0-pro-exp-02-05",
  mergeModel: "gemini-2.0-pro-exp-02-05",
  showProgress: true,
});

const transcription = await generateTranscription(inputFile, description, {
  transcriptionModel: "gemini-2.0-pro-exp-02-05",
  showProgress: true,
});

// Generate a structured report
const report = await generateReport(
  description.finalDescription,
  transcription.chunkTranscriptions.join("\n\n"),
  {
    model: "gemini-2.0-pro-exp-02-05",
    reportName: "meeting_summary",
    showProgress: true,
  }
);
```

## 🔧 Advanced Usage

### Intermediate Outputs

When run with the `-a` flag, offmute saves intermediate processing files:

```
input_file_intermediates/
├── screenshots/          # Video screenshots
├── audio/               # Processed audio chunks
├── transcription/       # Per-chunk transcriptions
└── report/             # Report generation data
```

### Custom Chunk Sizes

Adjust processing for different content types:

```bash
# Longer chunks for presentations
offmute presentation.mp4 -ac 20

# More screenshots for visual-heavy content
offmute workshop.mp4 -sc 8
```

## ⚙️ How It Works

offmute uses a multi-stage pipeline:

1. **Content Analysis**

   - Extracts screenshots from videos at key moments
   - Chunks audio into processable segments
   - Generates initial descriptions of visual and audio content

2. **Transcription & Diarization**

   - Processes audio chunks with context awareness
   - Identifies and labels speakers
   - Maintains conversation flow across chunks

3. **Report Generation (Spreadfill)**
   - Uses a unique "Spreadfill" technique:
     1. Generates report structure with section headings
     2. Fills each section independently using full context
     3. Ensures coherent narrative while maintaining detailed coverage

### Spreadfill Technique

The Spreadfill approach helps maintain consistency while allowing detailed analysis:

```typescript
// 1. Generate structure
const structure = await generateHeadings(description, transcript);

// 2. Fill sections independently
const sections = await Promise.all(
  structure.sections.map((section) => generateSection(section, fullContext))
);

// 3. Combine into coherent report
const report = combineResults(sections);
```

## 🛠️ Requirements

- Node.js 14 or later
- ffmpeg installed on your system
- Google Gemini API key

## Contributing

You can start in `TODOs.md` to help with things I'm thinking about, or you can steel yourself and check out `PROBLEMS.md`.

Created by [Hrishi Olickel](https://twitter.com/hrishioa) • Support offmute by starring our [GitHub repository](https://github.com/southbridgeai/offmute)
