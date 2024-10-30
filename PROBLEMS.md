Here's Claude tearing this repo apart:

# Code Review: Transcription System

## Critical Issues

### 1. Error Handling and Recovery

- No proper handling of corrupt audio/video files in `processAudioFile`
- Missing checks for FFmpeg installation/availability
- No validation of audio/video file integrity before processing
- Limited retry logic for FFmpeg operations
- No disk space checks before starting large file operations

### 2. Resource Management

- No cleanup of temporary files in error scenarios in `processAudioFile`
- Memory usage not monitored during large file processing
- No limits on concurrent FFmpeg processes
- Missing cleanup of screenshots in error scenarios
- No timeout handling for hanging FFmpeg processes

### 3. Input Validation

- Missing validation for negative numbers in time-based parameters
- No maximum file size checks
- Limited MIME type validation
- No validation of aspect ratio for screenshots

## Functional Improvements

### 1. Performance

- Could implement parallel processing for screenshot extraction
- Audio chunking could be optimized with streaming
- Potential for WebAssembly FFmpeg to reduce process spawning
- Consider caching for repeated operations on same file
- Missing progress tracking for file uploads to Gemini

### 2. Accuracy

- No confidence scores for transcription results
- Missing speaker diarization validation
- No handling of background noise/music
- No quality checks on extracted screenshots
- No validation of transcription coherence between chunks

### 3. Usability

```typescript
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
```

Could be improved with:

- Model validation
- Default values documentation
- Configuration validation
- Type safety for model names
- Clear documentation of units (minutes vs seconds)

## Security Considerations

### 1. File Operations

- Path traversal vulnerability in output path handling
- No sanitization of file names
- Potential shell injection in FFmpeg parameters
- Temporary file permissions not restricted
- No limits on concurrent operations

### 2. API Security

- API key handling could be improved
- No rate limiting implementation
- Missing request validation
- No audit logging of operations
- Credentials in environment variables need better documentation

## Code Quality Improvements

### 1. Testing

- Missing unit tests
- No integration tests
- No performance benchmarks
- No error scenario testing
- Missing mock implementations for FFmpeg

### 2. Documentation

- Missing JSDoc for many functions
- No API documentation
- Limited error code documentation
- No troubleshooting guide
- Missing architecture diagrams

### 3. Maintainability

```typescript
// Example of current implementation
async function processGenerationAttempt(
  model: GoogleGenerativeAI,
  fileManager: GoogleAIFileManager,
  modelName: string,
  prompt: string,
  files: FileInput[],
  temperature: number = 0,
  schema?: any
): Promise<GeminiResponse>;
```

Could be improved with:

- Better separation of concerns
- More modular design
- Configuration object pattern
- Consistent error handling
- Better type safety

## Specific Bug Fixes Needed

1. `utils/audio-chunk.ts`:

```typescript
function getFileDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      resolve(metadata.format.duration || 0); // Bug: Could resolve with 0 silently
    });
  });
}
```

2. `utils/screenshot.ts`:

```typescript
const startTime = duration * 0.01;
const endTime = duration * 0.99;
// Bug: No check for very short videos where this could result in invalid timestamps
```

3. `src/describe.ts`:

```typescript
if (screenshotBar) screenshotBar.update(50);
// Bug: Hard-coded progress values don't reflect actual progress
```

4. `src/transcribe.ts`:

```typescript
let previousTranscription = getLastNLines(transcriptionText, 20);
// Bug: Magic number and no consideration for very short lines
```

## Recommendations for Next Steps

1. Immediate Fixes:

- Implement proper cleanup handlers
- Add input validation
- Improve error handling
- Add basic security measures

2. Short-term Improvements:

- Add comprehensive testing
- Implement logging
- Add performance monitoring
- Improve documentation

## Best Practices to Implement

1. Code Organization:

- Consistent error handling
- Better type safety
- Clear naming conventions
- Proper separation of concerns

2. Operations:

- Proper logging
- Monitoring
- Resource management
- Error tracking

3. Security:

- Input validation
- Output sanitization
- Proper file permissions
- Rate limiting

Any of these are up for grabs to implement!
