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
- 🎬 **Video Analysis**: Extracts and analyzes visual information from video meetings, understand when demos are being displayed
- ⚡ **Multiple Processing Tiers**: From budget-friendly to premium processing options
- 🔄 **Robust Processing**: Handles long meetings with automatic chunking and proper cleanup
- 📁 **Flexible Output**: Markdown-formatted transcripts and reports with optional intermediate outputs
- 🔍 **Real-time Progress**: View transcription and report generation progress in real-time
- 🎯 **Custom Instructions**: Add your own context or instructions to guide the AI processing
- 🧹 **Clean Filesystem**: Temporary files are managed cleanly without cluttering your directories

## 🏃 Quick Start

```bash
# Set your Gemini API key
export GEMINI_API_KEY=your_key_here

# Run on a meeting recording (uses Gemini 2.5 Pro by default)
npx offmute path/to/your/meeting.mp4

# Use Flash model for faster processing
npx offmute path/to/your/meeting.mp4 --model flash
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

- `-m, --model <model>`: Model selection (pro, flash, flash-lite) [default: "pro"]
- `-t, --tier <tier>`: [DEPRECATED] Processing tier (first, business, economy, budget, experimental) - use --model instead
- `-s, --save-intermediates`: Save intermediate processing files
- `-id, --intermediates-dir <path>`: Custom directory for intermediate output
- `-sc, --screenshot-count <number>`: Number of screenshots to extract for video [default: 4]
- `-ac, --audio-chunk-minutes <number>`: Length of audio chunks in minutes [default: 10]
- `-r, --report`: Generate a structured meeting report
- `-rd, --reports-dir <path>`: Custom directory for report output
- `-i, --instructions <text>`: Custom context or instructions to include in AI prompts

### Model Selection

#### New Simple Model Options (Recommended)
- **Pro** (`pro`): Uses Gemini 2.5 Pro for all operations - highest quality
- **Flash** (`flash`): Uses Gemini 2.5 Flash for all operations - balanced performance
- **Flash Lite** (`flash-lite`): Uses Gemini 2.5 Flash Lite for all operations - fastest and most economical

#### Legacy Processing Tiers (Deprecated but still supported)
- **First Tier** (`first`): Uses Gemini 2.0 Pro models for all operations
- **Business Tier** (`business`): Gemini 2.0 Pro for description and report, Gemini 2.0 Flash for transcription
- **Economy Tier** (`economy`): Gemini 2.0 Flash models for all operations
- **Budget Tier** (`budget`): Gemini 2.0 Flash for description, Gemini 2.0 Flash Lite for transcription and report
- **Experimental Tier** (`experimental`): Uses the cutting-edge Gemini 2.5 Pro Preview model for all operations
- **Experimental Budget Tier** (`experimentalBudget`): Uses the cutting-edge Gemini 2.5 Flash Preview model for all operations

### As a Module

```typescript
import {
  generateDescription,
  generateTranscription,
  generateReport,
} from "offmute";

// Generate description and transcription
const description = await generateDescription(inputFile, {
  screenshotModel: "gemini-2.5-pro",
  audioModel: "gemini-2.5-pro",
  mergeModel: "gemini-2.5-pro",
  showProgress: true,
  userInstructions: "Focus on technical content and action items",
});

const transcription = await generateTranscription(inputFile, description, {
  transcriptionModel: "gemini-2.5-pro",
  showProgress: true,
  userInstructions: "Add emotions and tone information for each speaker",
});

// Generate a structured report
const report = await generateReport(
  description.finalDescription,
  transcription.chunkTranscriptions.join("\n\n"),
  {
    model: "gemini-2.5-pro",
    reportName: "meeting_summary",
    showProgress: true,
    userInstructions: "Highlight all action items with bullet points",
  }
);
```

## 🔧 Advanced Usage

### Intermediate Files and Directories

By default, offmute uses a system temporary directory to store intermediate files and cleans them up when processing completes. If you want to save these files:

```bash
# Save intermediates in a hidden .offmute_[filename] directory
npx offmute meeting.mp4 --save-intermediates

# Save intermediates in a custom directory
npx offmute meeting.mp4 --save-intermediates --intermediates-dir ./processing_files
```

When saved, intermediate files are organized in a clean structure:

```
.offmute_meeting/
├── screenshots/          # Video screenshots
├── audio/                # Processed audio chunks
├── transcription/        # Per-chunk transcriptions
└── report/               # Report generation data
```

### Custom Instructions

You can provide custom instructions to the AI models to focus on specific aspects:

```bash
# Use Flash model for faster processing
npx offmute meeting.mp4 --model flash

# Use Flash Lite for the most economical option
npx offmute long_conference.mp4 --model flash-lite

# Focus on technical details with Pro model (default)
npx offmute technical_meeting.mp4 -i "Focus on technical terminology and highlight all action items"

# Improve speaker emotion detection with Flash model
npx offmute interview.mp4 --model flash -i "Pay special attention to emotional tone and hesitations"
```

### Real-time Progress Tracking

Offmute now creates output files early in the process and updates them incrementally, allowing you to:

1. See transcription progress in real-time
2. Monitor report generation section by section
3. Check partial results even for long-running processes

### Model Selection Examples

```bash
# Use Pro model for highest quality (default)
npx offmute important_meeting.mp4

# Use Flash model for balanced performance
npx offmute team_standup.mp4 --model flash

# Use Flash Lite for quick and economical processing
npx offmute daily_brief.mp4 --model flash-lite

# Combine with custom instructions for best results
npx offmute strategic_call.mp4 --model pro -i "Focus on financial projections and strategic initiatives"
```

The Gemini 2.5 models support expanded token output capabilities, allowing for more detailed and comprehensive results, especially for longer meetings or when generating complex reports.

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
   - Shows real-time progress in the output file

3. **Report Generation (Spreadfill)**
   - Uses a unique "Spreadfill" technique:
     1. Generates report structure with section headings
     2. Fills each section independently using full context
     3. Ensures coherent narrative while maintaining detailed coverage
   - Updates report file in real-time as sections are completed

### Metadata Management

Offmute now includes accurate file metadata in outputs:

- File creation and modification dates
- Processing timestamp
- File size and path information
- Custom instructions (when provided)

This provides reliable context without AI guessing incorrect meeting dates/times.

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

# OffMute Server - Meeting Transcription & Analysis

OffMute is a Docker-based server application for intelligent transcription, diarization, and analysis of meeting recordings using Google's Gemini AI models.

## Overview

OffMute processes audio and video files to:

- Transcribe speech with speaker identification
- Generate detailed meeting descriptions
- Create structured reports with key points and action items
- Extract and analyze visual content from video meetings

## Requirements

- Docker and Docker Compose
- **Google Gemini API key (required)** - Users must provide their own API key
- Sufficient disk space for processing media files

## Installation in Unraid

### Method 1: Using Docker Compose

1. SSH into your Unraid server
2. Create a directory for OffMute:
   ```bash
   mkdir -p /mnt/user/appdata/offmute
   cd /mnt/user/appdata/offmute
   ```
3. Download the docker-compose.yml file:
   ```bash
   wget https://raw.githubusercontent.com/siomochkin/offmute-server/master/docker-compose.yml
   ```
4. Create a `.env` file:
   ```bash
   echo "GEMINI_API_KEY=your_key_here" > .env
   ```
   Note: If you don't set this environment variable, users will need to provide their own API key with each request.

5. Run the container:
   ```bash
   docker-compose up -d
   ```

### Method 2: Using Unraid Docker Manager UI

1. Go to the **Docker** tab in your Unraid web interface
2. Click **Add Container**
3. Enter the following information:
   - **Name**: offmute
   - **Repository**: siomochkin/offmute-server:latest
   - Add port mapping:
     - **Host Port**: 6543
     - **Container Port**: 6543
   - Add variable:
     - **Name**: GEMINI_API_KEY
     - **Value**: your_gemini_api_key
     - **Description**: Google Gemini API Key (optional, users can provide their own)
   - Add path mapping:
     - **Host Path**: /mnt/user/appdata/offmute/uploads
     - **Container Path**: /app/uploads
     - **Description**: Persistent storage for uploads

4. Click **Apply**

## Accessing OffMute

After installation, OffMute is available at:

- **Local Access**: http://your-unraid-ip:6543
- **With Reverse Proxy**: https://offmute.yourdomain.com (after configuring reverse proxy)

## Setting Up Reverse Proxy

### Using Swag/NGINX in Unraid

Add the following configuration to your NGINX site config:

```nginx
server {
    listen 443 ssl http2;
    server_name offmute.yourdomain.com;

    # SSL configuration
    include /config/nginx/ssl.conf;

    # Proxy settings
    location / {
        include /config/nginx/proxy.conf;
        proxy_pass http://unraid-ip:6543;
    }

    # Large file uploads - adjust if needed
    client_max_body_size 2000M;
}
```

## Streaming Configuration for Traefik

If you're using Traefik as a reverse proxy, you need to add the following middleware configuration to support streaming responses properly:

```yaml
# In your Traefik configuration file
http:
  middlewares:
    streaming-headers:
      headers:
        customResponseHeaders:
          Cache-Control: "no-cache"
          X-Accel-Buffering: "no"
          Content-Type: "text/event-stream"

  routers:
    summariser:  # or whatever your router name is
      middlewares:
        - streaming-headers
        - largeUpload  # keep existing middlewares
```

This configuration ensures that server-sent events (streaming responses) are properly handled by the Traefik proxy.

## API Usage Guide

### 1. Upload and Process a Meeting Recording

```bash
curl -F "file=@meeting.mp4;type=video/mp4" \
     -F "generateReport=true" \
     -F "apiKey=your_gemini_api_key" \
     http://localhost:6543/api/process
```

**Note:** The `apiKey` parameter is required if you haven't set the GEMINI_API_KEY environment variable.

### 2. Check Job Status

```bash
curl http://localhost:6543/api/jobs/1234567890
```

### 3. Download Results

```bash
# Download the description
curl -O http://localhost:6543/api/results/1234567890/description

# Download the transcription
curl -O http://localhost:6543/api/results/1234567890/transcription

# Download the report (if generated)
curl -O http://localhost:6543/api/results/1234567890/report
```

## Troubleshooting

### Common Issues

1. **Container won't start**:
   - Check if the GEMINI_API_KEY environment variable is set
   - Verify the volume paths exist and have correct permissions

2. **Upload errors**:
   - Ensure your reverse proxy allows large file uploads (client_max_body_size)
   - Check if the uploads directory has enough free space

3. **Processing failures**:
   - Check container logs: `docker logs offmute`
   - Verify your Gemini API key is valid and has enough quota

## Getting Help

- GitHub Issues: [offmute-server Issues](https://github.com/siomochkin/offmute-server/issues)
- Documentation: See the [DOCKER_API_README.md](https://github.com/siomochkin/offmute-server/blob/master/DOCKER_API_README.md) for detailed API usage
