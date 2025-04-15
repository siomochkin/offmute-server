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

# OffMute Server - Unraid Docker Setup Guide

This guide provides instructions for setting up OffMute Server in Unraid using Docker.

## Overview

OffMute is a privacy-focused service that provides intelligent transcription, diarization, and analysis of meeting recordings using Google's Gemini AI models. It processes audio and video files to:

- Transcribe speech with speaker identification
- Generate meeting descriptions
- Create structured reports with key points and action items
- Extract and analyze visual content from video meetings

## Requirements

- Unraid server (6.9.0+)
- Docker already installed on Unraid
- Google Gemini API key
- Reverse proxy (recommended for secure access)

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
     - **Description**: Google Gemini API Key
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

## Security Considerations

1. **API Key Protection**:
   - Your Gemini API key is stored in the Unraid Docker environment variables
   - Never expose your API key in client-side code

2. **File Security**:
   - All uploaded files are stored in the mapped volume
   - Permissions are controlled by the container

3. **Network Security**:
   - Use a reverse proxy with SSL for secure access
   - Consider adding authentication through your reverse proxy

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
- Documentation: See the [DOCKER_API_README.md](https://github.com/siomochkin/offmute-server/blob/master/DOCKER_API_README.md) for API usage
