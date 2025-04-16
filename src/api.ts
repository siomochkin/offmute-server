import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { generateDescription, generateTranscription, generateReport } from './index';
import { GenerateReportResult } from './report';
import crypto from 'crypto';
import { exec } from 'child_process';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 6543;

// Simple rate limiting middleware
const rateLimiter = (() => {
  const requestCounts = new Map<string, {count: number, resetTime: number}>();
  
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Get client IP
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    // Allow health checks to bypass rate limiting
    if (req.path === '/health') {
      return next();
    }
    
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const maxRequestsPerWindow = 10; // Maximum requests per window
    
    // Initialize or get current count
    if (!requestCounts.has(ip) || requestCounts.get(ip)!.resetTime < now) {
      requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    const requestData = requestCounts.get(ip)!;
    
    // Increment count
    requestData.count++;
    
    // Check if limit exceeded
    if (requestData.count > maxRequestsPerWindow) {
      return res.status(429).json({ 
        error: 'Too many requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
    
    next();
  };
})();

// Apply rate limiting to all requests
app.use(rateLimiter);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename and use random string to prevent guessing
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const randomString = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${randomString}-${sanitizedFilename}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 2000 }, // 2GB max file size (increased from 500MB)
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/webm'];
    const allowedExtensions = ['.mp4', '.webm', '.mp3', '.wav'];
    
    // Check if it's a recognized mimetype
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    
    // Check if it has an allowed extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
      return;
    }
    
    // If we got here, the file type is not allowed
    cb(new Error('Invalid file type. Only video and audio files are allowed.') as any);
  }
});

// Add error handler for multer
const uploadHandler = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err instanceof multer.MulterError) {
        // A Multer error occurred when uploading
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ 
            error: 'File too large. Maximum file size is 2GB',
            code: 'FILE_TOO_LARGE'
          });
        }
        return res.status(400).json({ error: err.message, code: err.code });
      }
      // An unknown error occurred
      return res.status(500).json({ error: err.message });
    }
    next();
  });
};

// Security middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Remove sensitive headers that might leak information
  res.removeHeader('X-Powered-By');
  
  next();
});

// Trust proxy - important for running behind reverse proxy
app.set('trust proxy', 1);

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res, path) => {
    // Prevent directory listing
    if (fs.statSync(path).isDirectory()) {
      return res.status(403).end('403 Forbidden');
    }
    // Set no-cache headers for sensitive files
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Validate numeric parameters
function validateNumericParam(value: any, min: number, max: number, defaultValue: number): number {
  const parsed = parseInt(value);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    return defaultValue;
  }
  return parsed;
}

// Storage for tracking upload chunks
interface FileUploadStatus {
  jobId: string;
  filename: string;
  fileSize: number;
  fileType: string;
  chunks: {
    [index: number]: string; // Path to chunk file
  };
  totalChunks: number;
  receivedChunks: number;
  outputDir: string;
  processing: {
    tier: string;
    screenshotCount: number;
    audioChunkMinutes: number;
    generateReport: boolean;
    apiKey?: string;
    instructions?: string;
  };
  completed: boolean;
  createdAt: number;
}

// Map to store active uploads
const activeUploads = new Map<string, FileUploadStatus>();

// Initialize a chunked upload
app.post('/api/init-upload', express.json(), async (req, res) => {
  try {
    console.log('==== INIT CHUNKED UPLOAD ====');
    
    const { 
      filename, 
      fileSize, 
      fileType,
      tier,
      screenshotCount,
      audioChunkMinutes,
      generateReport,
      streamResponse,
      apiKey,
      instructions
    } = req.body;
    
    // Validate input
    if (!filename || !fileSize || !fileType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if file size is too large (over 2GB)
    if (fileSize > 2 * 1024 * 1024 * 1024) {
      return res.status(413).json({ 
        error: 'File too large. Maximum file size is 2GB',
        code: 'FILE_TOO_LARGE'
      });
    }
    
    // Validate API key - first from request, then from env
    const finalApiKey = apiKey || process.env.GEMINI_API_KEY;
    if (!finalApiKey) {
      return res.status(400).json({ 
        error: 'Missing API key. You must provide a Google Gemini API key either in the request or as an environment variable.',
        code: 'MISSING_API_KEY'
      });
    }
    
    // Create job ID and output directory
    const jobId = crypto.randomUUID();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const outputDir = path.join(__dirname, '../uploads', `${jobId}-${sanitizedFilename}`);
    
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`Created output directory: ${outputDir}`);
      
      // Create chunks directory
      const chunksDir = path.join(outputDir, 'chunks');
      fs.mkdirSync(chunksDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating upload directories: ${error}`);
      return res.status(500).json({ error: 'Failed to create upload directories' });
    }
    
    // Create upload status
    const uploadStatus: FileUploadStatus = {
      jobId,
      filename: sanitizedFilename,
      fileSize,
      fileType,
      chunks: {},
      totalChunks: Math.ceil(fileSize / (5 * 1024 * 1024)), // 5MB chunks
      receivedChunks: 0,
      outputDir,
      processing: {
        tier: tier || 'business',
        screenshotCount: validateNumericParam(screenshotCount, 1, 20, 4),
        audioChunkMinutes: validateNumericParam(audioChunkMinutes, 1, 30, 10),
        generateReport: generateReport === 'true' || generateReport === true,
        apiKey: finalApiKey,
        instructions: instructions
      },
      completed: false,
      createdAt: Date.now()
    };
    
    // Store upload status
    activeUploads.set(jobId, uploadStatus);
    
    // Respond with job ID
    console.log(`Initialized chunked upload ${jobId} for ${sanitizedFilename}`);
    res.json({ 
      jobId,
      totalChunks: uploadStatus.totalChunks,
      chunkSize: 5 * 1024 * 1024
    });
    
    // Set a cleanup timer for abandoned uploads (2 hours)
    setTimeout(() => {
      const upload = activeUploads.get(jobId);
      if (upload && !upload.completed) {
        console.log(`Cleaning up abandoned upload ${jobId}`);
        activeUploads.delete(jobId);
        // Optionally delete the upload directory
        try {
          fs.rmSync(upload.outputDir, { recursive: true, force: true });
        } catch (err) {
          console.error(`Error cleaning up abandoned upload ${jobId}:`, err);
        }
      }
    }, 2 * 60 * 60 * 1000);
    
  } catch (error) {
    console.error('Error initializing upload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload a chunk
app.post('/api/upload-chunk/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Check if the upload exists
    const uploadStatus = activeUploads.get(jobId);
    if (!uploadStatus) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    // Use multer for handling multipart form data
    const chunkStorage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, path.join(uploadStatus.outputDir, 'chunks'));
      },
      filename: (req, file, cb) => {
        const chunkIndex = req.body.chunkIndex || '0';
        cb(null, `chunk-${chunkIndex}`);
      }
    });
    
    const uploadChunk = multer({ 
      storage: chunkStorage,
      limits: { fileSize: 10 * 1024 * 1024 } // 10MB max chunk size
    }).single('chunk');
    
    uploadChunk(req, res, (err) => {
      if (err) {
        console.error('Error uploading chunk:', err);
        return res.status(400).json({ error: err.message });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'No chunk uploaded' });
      }
      
      const chunkIndex = parseInt(req.body.chunkIndex || '0');
      const totalChunks = parseInt(req.body.totalChunks || '1');
      
      // Update upload status
      uploadStatus.chunks[chunkIndex] = req.file.path;
      uploadStatus.receivedChunks++;
      uploadStatus.totalChunks = totalChunks;
      
      console.log(`Received chunk ${chunkIndex + 1}/${totalChunks} for upload ${jobId}`);
      
      // Respond with success
      res.json({
        chunkIndex,
        receivedChunks: uploadStatus.receivedChunks,
        totalChunks,
        complete: uploadStatus.receivedChunks === totalChunks
      });
    });
  } catch (error) {
    console.error('Error uploading chunk:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process video/audio file with single request upload
app.post('/api/process', uploadHandler, async (req, res) => {
  try {
    console.log('==== API PROCESS REQUEST START ====');
    
    if (!req.file) {
      console.error('No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log(`File received: ${req.file.originalname}, size: ${req.file.size} bytes`);
    
    // Validate API key - first from request, then from env
    const apiKey = req.body.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('Missing API key');
      return res.status(400).json({ 
        error: 'Missing API key. You must provide a Google Gemini API key either in the request or as an environment variable.',
        code: 'MISSING_API_KEY'
      });
    }
    
    console.log(`API key validation: ${apiKey ? 'Valid key provided' : 'No key'}`);
    const filePath = req.file.path;
    
    // Validate and sanitize input parameters
    const tier = (req.body.tier || 'business').toString().toLowerCase();
    const screenshotCount = validateNumericParam(req.body.screenshotCount, 1, 20, 4);
    const audioChunkMinutes = validateNumericParam(req.body.audioChunkMinutes, 1, 30, 10);
    
    // Get custom instructions if provided and sanitize
    const instructions = req.body.instructions ? String(req.body.instructions).slice(0, 2000) : undefined;
    
    // More robust parameter parsing for boolean values - handle various formats
    const generateReportFlag = req.body.generateReport === 'true' || 
                              req.body.generateReport === true || 
                              req.body.generateReport === '1' || 
                              req.body.generateReport === 1;
    
    const streamResponse = req.body.streamResponse === 'true' || 
                          req.body.streamResponse === true || 
                          req.body.streamResponse === '1' || 
                          req.body.streamResponse === 1;
    
    // Log sanitized parameters (without exposing API key)
    console.log('Request parameters:', {
      tier,
      screenshotCount,
      audioChunkMinutes,
      generateReportFlag,
      streamResponse,
      instructions: instructions ? 'Provided' : 'Not provided',
      apiKeyProvided: !!apiKey
    });

    // Determine which models to use based on tier
    const modelConfig = getTierConfig(tier);
    console.log('Using models:', modelConfig);

    // Create job ID and output directory
    const jobId = crypto.randomUUID();
    const outputDir = path.join(__dirname, '../uploads', `${jobId}-${path.basename(filePath, path.extname(filePath))}`);
    
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`Created output directory: ${outputDir}`);
    } catch (error) {
      console.error(`Error creating output directory: ${error}`);
      return res.status(500).json({ error: 'Failed to create job directory' });
    }
    
    // Initial response for both streaming and non-streaming
    if (streamResponse) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Prevent Nginx buffering
      
      // Send initial event
      res.write(`data: ${JSON.stringify({
        jobId,
        status: 'processing',
        progress: 0,
        message: 'Starting processing...'
      })}\n\n`);
    } else {
      // For non-streaming, just return the job ID
      res.json({ jobId });
      console.log('Sent non-streaming response with job ID');
    }
    
    // Start processing in background
    if (streamResponse) {
      console.log('Beginning background processing with streaming updates');
      // Create a mock request with the uploaded file info for our streaming processor
      const mockReq: any = {
        file: req.file,
        body: req.body
      };
      
      // Function to properly format SSE messages
      const sendSSE = (data: any) => {
        const jsonStr = JSON.stringify(data);
        
        // For large data objects, we need special handling to avoid chunking issues
        if (jsonStr.length > 10000) {
          console.log(`Large SSE message detected (${jsonStr.length} bytes), truncating content for streaming`);
          
          // Clone the data to avoid modifying the original
          const streamData = { ...data };
          
          // Truncate large text fields for the streaming update
          if (streamData.description && streamData.description.length > 1000) {
            streamData.description = streamData.description.substring(0, 1000) + '... [content truncated for streaming]';
          }
          
          if (streamData.transcription && streamData.transcription.length > 1000) {
            streamData.transcription = streamData.transcription.substring(0, 1000) + '... [content truncated for streaming]';
          }
          
          if (streamData.report && streamData.report.length > 1000) {
            streamData.report = streamData.report.substring(0, 1000) + '... [content truncated for streaming]';
          }
          
          // Send the status update with truncated content
          const truncatedMessage = `data: ${JSON.stringify(streamData)}\n\n`;
          console.log(`Sending truncated SSE update: ${truncatedMessage.substring(0, 100)}...`);
          res.write(truncatedMessage);
          
          // For the final 'completed' status, we'll handle it differently
          if (data.status === 'completed') {
            // Send individual updates for each large piece of content
            if (data.description && data.description.length > 1000) {
              const descMsg = `data: {"jobId":"${data.jobId}","status":"description_content","description":${JSON.stringify(data.description)}}\n\n`;
              console.log('Sending full description separately');
              res.write(descMsg);
            }
            
            if (data.transcription && data.transcription.length > 1000) {
              const transMsg = `data: {"jobId":"${data.jobId}","status":"transcription_content","transcription":${JSON.stringify(data.transcription)}}\n\n`;
              console.log('Sending full transcription separately');
              res.write(transMsg);
            }
            
            if (data.report && data.report.length > 1000) {
              const reportMsg = `data: {"jobId":"${data.jobId}","status":"report_content","report":${JSON.stringify(data.report)}}\n\n`;
              console.log('Sending full report separately');
              res.write(reportMsg);
            }
            
            // Finally send a completion message with all metadata but without the large content
            const completionData = {
              jobId: data.jobId,
              status: 'fully_completed',
              progress: 100,
              message: 'Processing complete!',
              inputFile: data.inputFile,
              outputs: data.outputs,
              downloadLinks: data.downloadLinks
            };
            
            const completionMsg = `data: ${JSON.stringify(completionData)}\n\n`;
            console.log('Sending final completion message');
            res.write(completionMsg);
          }
        } else {
          // For smaller messages, send as normal
          const message = `data: ${jsonStr}\n\n`;
          console.log(`Sending SSE update: ${message.substring(0, 100)}...`);
          res.write(message);
        }
      };
      
      // Process the file with streaming updates
      processStreamingFile(mockReq, res, outputDir, jobId, sendSSE);
    } else {
      console.log('Beginning background processing for polling mode');
      // Process the file for polling mode
      // Create a mock request here as well to pass to processPollingFile
      const mockReq: any = {
        file: req.file,
        body: req.body
      };
      processPollingFile(mockReq, outputDir, jobId);
    }
  } catch (error) {
    console.error('Error processing upload:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
});

// Process file with streaming updates
async function processStreamingFile(req: any, res: any, outputDir: string, jobId: string, sendSSE: any) {
  try {
    console.log('Starting media processing');
    
    try {
      // Process steps with stream updates
      const mediaInfo = await getMediaInfo(req.file.path);
      console.log(`Media info extracted: ${JSON.stringify(mediaInfo)}`);
      
      // Send update
      sendSSE({
        jobId,
        status: 'processing',
        progress: 10,
        message: 'Analyzing media file...'
      });
      
      // Generate screenshots if it's a video
      let screenshotPaths: string[] = [];
      if (mediaInfo.isVideo) {
        console.log('Generating screenshots');
        screenshotPaths = await generateScreenshots(req.file.path, outputDir, req.body.screenshotCount);
        console.log(`Generated ${screenshotPaths.length} screenshots`);
        
        // Send update
        sendSSE({
          jobId,
          status: 'processing',
          progress: 20,
          message: 'Screenshots generated...'
        });
      }
      
      // Generate content description
      const apiKey = req.body.apiKey || process.env.GEMINI_API_KEY;
      const modelConfig = getTierConfig(req.body.tier || 'business');
      
      console.log('Generating content description');
      const description = await generateContentDescription(
        req.file.path, 
        outputDir, 
        mediaInfo, 
        screenshotPaths,
        apiKey,
        modelConfig.screenshotModel,
        modelConfig.audioModel,
        modelConfig.mergeModel,
        req.body.instructions,
        req.body.audioChunkMinutes
      );
      console.log('Content description complete');
      
      // Write description to file
      const descriptionPath = path.join(outputDir, `${path.basename(req.file.path, path.extname(req.file.path))}_description.md`);
      fs.writeFileSync(descriptionPath, description);
      console.log(`Description saved to ${descriptionPath}`);
      
      // Send update
      sendSSE({
        jobId,
        status: 'description_complete',
        progress: 40,
        message: 'Description complete, generating transcription...',
        description
      });
      
      // Generate transcription if needed
      console.log('Starting transcription generation');
      
      // First generate description result for transcription input
      const descriptionResult = await generateDescription(req.file.path, {
        screenshotModel: modelConfig.screenshotModel,
        audioModel: modelConfig.audioModel,
        mergeModel: modelConfig.mergeModel,
        screenshotCount: screenshotPaths.length,
        transcriptionChunkMinutes: req.body.audioChunkMinutes,
        outputPath: outputDir,
        showProgress: true,
        userInstructions: req.body.instructions,
        apiKey
      });
      
      // Then generate transcription
      const transcriptionResult = await generateTranscription(
        req.file.path, 
        descriptionResult,
        {
          transcriptionModel: modelConfig.transcriptionModel,
          outputPath: outputDir,
          showProgress: true,
          userInstructions: req.body.instructions,
          apiKey
        }
      );
      
      // Read the transcription content
      const transcriptionContent = fs.readFileSync(transcriptionResult.transcriptionPath, 'utf-8');
      console.log('Transcription complete');
      
      // Send update
      sendSSE({
        jobId,
        status: 'transcription_complete',
        progress: 80,
        message: 'Transcription complete...',
        description,
        transcription: transcriptionContent
      });

      // Generate technical report if requested
      let reportResult: { report: string; reportPath: string } | null = null;
      if (req.body.generateReport === 'true' || req.body.generateReport === true) {
        console.log('Generating technical report');
        reportResult = await generateTechnicalReport(
          req.file.path,
          outputDir,
          mediaInfo,
          description,
          transcriptionContent,
          apiKey,
          modelConfig.reportModel
        );
        console.log('Technical report complete');
        console.log(`Report saved to ${reportResult.reportPath}`);
        console.log(`Report content length: ${reportResult.report.length} characters`);
      }

      // Create final result summary
      const resultSummary = {
        jobId,
        status: 'completed',
        progress: 100,
        message: 'Processing complete!',
        inputFile: req.file ? req.file.originalname : path.basename(req.file.path),
        description,
        transcription: transcriptionContent,
        report: reportResult ? reportResult.report : null,
        outputs: {
          descriptionFile: path.relative(path.join(__dirname, '..'), descriptionPath),
          transcriptionFile: path.relative(path.join(__dirname, '..'), transcriptionResult.transcriptionPath),
          reportFile: reportResult ? path.relative(path.join(__dirname, '..'), reportResult.reportPath) : null,
        },
        downloadLinks: {
          description: `/api/results/${jobId}/description`,
          transcription: `/api/results/${jobId}/transcription`,
          report: reportResult ? `/api/results/${jobId}/report` : null,
        }
      };

      // Sanity check result summary
      console.log('Final result summary properties:', Object.keys(resultSummary));
      console.log('Report included in result summary:', resultSummary.report ? 'Yes' : 'No');

      // Save result summary
      fs.writeFileSync(
        path.join(outputDir, 'result.json'),
        JSON.stringify(resultSummary, null, 2)
      );
      console.log('Results saved to disk');

      // Send final update
      sendSSE(resultSummary);
      console.log('Final update sent, closing stream');
      
      // Close the connection
      res.end();
    } catch (processingError) {
      console.error('Error during media processing:', processingError);
      // Send error update
      sendSSE({
        jobId,
        status: 'failed',
        error: processingError instanceof Error ? processingError.message : String(processingError)
      });
      
      // Close the connection
      res.end();
      
      // Save error info
      fs.writeFileSync(
        path.join(outputDir, 'error.json'),
        JSON.stringify({
          jobId,
          status: 'failed',
          error: processingError instanceof Error ? processingError.message : String(processingError),
          timestamp: new Date().toISOString()
        }, null, 2)
      );
    }
  } catch (error) {
    console.error('Fatal error in background processing:', error);
    // Save error info
    const errorMessage = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(
      path.join(outputDir, 'error.json'),
      JSON.stringify({
        jobId,
        status: 'failed',
        error: errorMessage,
        timestamp: new Date().toISOString()
      }, null, 2)
    );
  }
}

// Process file with polling updates
async function processPollingFile(req: any, outputDir: string, jobId: string) {
  try {
    // Process the file using existing logic for non-streaming requests
    // This would be similar to the existing non-streaming code path in the /api/process endpoint
    
    console.log(`Processing file for polling: ${jobId}`);
    
    // Save a result summary file with processing status
    fs.writeFileSync(
      path.join(outputDir, 'result.json'),
      JSON.stringify({
        jobId,
        status: 'processing',
        message: 'Processing started',
        timestamp: new Date().toISOString()
      }, null, 2)
    );
    
    // Further processing would continue here...
    // This would be the same as your existing non-streaming code
  } catch (error) {
    console.error('Error in polling file processing:', error);
    fs.writeFileSync(
      path.join(outputDir, 'error.json'),
      JSON.stringify({
        jobId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }, null, 2)
    );
  }
}

// Check job status
app.get('/api/jobs/:jobId', (req, res) => {
  try {
    // Validate and sanitize jobId parameter to prevent path traversal
    const jobId = req.params.jobId.replace(/[^a-zA-Z0-9_-]/g, '');
    
    if (!jobId || jobId.length < 10) {
      return res.status(400).json({ error: 'Invalid job ID format', code: 'INVALID_JOB_ID' });
    }
    
    // Look for job results or errors
    const uploadsDir = path.join(__dirname, '../uploads');
    
    // Check if uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      return res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
    }
    
    const dirs = fs.readdirSync(uploadsDir);
    
    for (const dir of dirs) {
      // Skip directories that don't start with the jobId
      if (!dir.startsWith(jobId)) continue;
      
      const dirPath = path.join(uploadsDir, dir);
      const stat = fs.statSync(dirPath);
      
      if (stat.isDirectory()) {
        // Check for result.json
        const resultPath = path.join(dirPath, 'result.json');
        if (fs.existsSync(resultPath)) {
          try {
            const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            if (result.jobId === jobId) {
              return res.json(result);
            }
          } catch (e) {
            console.error(`Error parsing result.json for job ${jobId}:`, e);
            // Continue checking other files
          }
        }
        
        // Check for error.json
        const errorPath = path.join(dirPath, 'error.json');
        if (fs.existsSync(errorPath)) {
          try {
            const error = JSON.parse(fs.readFileSync(errorPath, 'utf8'));
            if (error.jobId === jobId) {
              return res.status(500).json(error);
            }
          } catch (e) {
            console.error(`Error parsing error.json for job ${jobId}:`, e);
            // Continue checking other files
          }
        }
      }
    }
    
    // Job not found
    res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
  } catch (error) {
    console.error('Error checking job status:', error);
    res.status(500).json({ 
      error: 'An error occurred while checking job status',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get specific result files
app.get('/api/results/:jobId/:type', (req, res) => {
  try {
    // Validate and sanitize jobId parameter
    const jobId = req.params.jobId.replace(/[^a-zA-Z0-9_-]/g, '');
    
    if (!jobId || jobId.length < 10) {
      return res.status(400).json({ error: 'Invalid job ID format', code: 'INVALID_JOB_ID' });
    }
    
    // Validate and sanitize type parameter
    const type = req.params.type;
    const validTypes = ['description', 'transcription', 'report'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        error: 'Invalid result type. Must be one of: description, transcription, report',
        code: 'INVALID_TYPE'
      });
    }
    
    // Look for job results
    const uploadsDir = path.join(__dirname, '../uploads');
    const dirs = fs.readdirSync(uploadsDir);
    
    for (const dir of dirs) {
      // Skip directories that don't start with the jobId
      if (!dir.startsWith(jobId)) continue;
      
      const dirPath = path.join(uploadsDir, dir);
      const stat = fs.statSync(dirPath);
      
      if (stat.isDirectory()) {
        // Check for result.json
        const resultPath = path.join(dirPath, 'result.json');
        if (fs.existsSync(resultPath)) {
          try {
            const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            if (result.jobId === jobId) {
              let filePath;
              let fileName;
              
              switch (type) {
                case 'description':
                  filePath = path.join(__dirname, '..', result.outputs.descriptionFile);
                  fileName = 'description.md';
                  break;
                case 'transcription':
                  filePath = path.join(__dirname, '..', result.outputs.transcriptionFile);
                  fileName = 'transcription.md';
                  break;
                case 'report':
                  if (!result.outputs.reportFile) {
                    return res.status(404).json({ error: 'Report not generated for this job' });
                  }
                  filePath = path.join(__dirname, '..', result.outputs.reportFile);
                  fileName = 'report.md';
                  break;
                default:
                  return res.status(400).json({ error: 'Invalid result type' });
              }
              
              // Validate the file path is still within the uploads directory to prevent path traversal
              const normalizedFilePath = path.normalize(filePath);
              const normalizedUploadsDir = path.normalize(path.join(__dirname, '../uploads'));
              
              if (!normalizedFilePath.startsWith(normalizedUploadsDir)) {
                return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
              }
              
              if (fs.existsSync(filePath)) {
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.setHeader('Content-Type', 'text/markdown');
                return res.sendFile(filePath);
              } else {
                return res.status(404).json({ error: 'Result file not found' });
              }
            }
          } catch (e) {
            console.error(`Error processing result for job ${jobId}:`, e);
            return res.status(500).json({ 
              error: 'An error occurred while processing the result',
              code: 'INTERNAL_ERROR'
            });
          }
        }
      }
    }
    
    // Job not found
    res.status(404).json({ error: 'Job not found' });
  } catch (error) {
    console.error('Error retrieving result:', error);
    res.status(500).json({ 
      error: 'An error occurred while retrieving the result',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Cleanup old jobs - run every day
const ONE_DAY = 24 * 60 * 60 * 1000;
const JOB_RETENTION_DAYS = 7; // Keep jobs for 7 days

function cleanupOldJobs() {
  try {
    console.log('Running cleanup of old jobs...');
    const uploadsDir = path.join(__dirname, '../uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      console.log('Uploads directory does not exist, skipping cleanup');
      return;
    }
    
    const now = Date.now();
    const dirs = fs.readdirSync(uploadsDir);
    
    for (const dir of dirs) {
      const dirPath = path.join(uploadsDir, dir);
      const stat = fs.statSync(dirPath);
      
      if (stat.isDirectory()) {
        // Extract timestamp from directory name (format: timestamp-randomstring)
        const match = dir.match(/^(\d+)-/);
        if (match) {
          const timestamp = parseInt(match[1]);
          
          // If directory is older than retention period, delete it
          if (now - timestamp > JOB_RETENTION_DAYS * ONE_DAY) {
            try {
              fs.rmSync(dirPath, { recursive: true, force: true });
              console.log(`Removed old job directory: ${dir}`);
            } catch (err) {
              console.error(`Failed to remove old job directory ${dir}:`, err);
            }
          }
        }
      }
    }
    
    console.log('Cleanup completed');
  } catch (err) {
    console.error('Error during cleanup:', err);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    version: process.env.npm_package_version || '0.0.5',
    uptime: process.uptime()
  });
});

// Start server and report status
app.listen(port, () => {
  console.log(`OffMute API server is running on http://localhost:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ Warning: GEMINI_API_KEY environment variable not set. Users MUST provide their own API key with each request.');
  } else {
    console.log('✅ GEMINI_API_KEY environment variable is set. Users can optionally override it with their own API key.');
  }
  
  // Check for uploads directory and create if not exists
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log('Created uploads directory at', uploadsDir);
    } catch (err) {
      console.error('Failed to create uploads directory:', err);
    }
  }
  
  // Schedule cleanup to run every day
  setInterval(cleanupOldJobs, ONE_DAY);
  // Run cleanup at startup
  setTimeout(cleanupOldJobs, 60000); // Wait 1 minute after startup
});

export { app };

/**
 * Get model configuration based on tier
 */
function getTierConfig(tier: string) {
  // Validate tier
  const validTiers = ['first', 'business', 'economy', 'budget', 'experimental'];
  if (!validTiers.includes(tier)) {
    throw new Error(`Invalid tier. Must be one of: ${validTiers.join(', ')}`);
  }

  // Default configuration
  let config = {
    screenshotModel: 'gemini-1.5-flash',
    audioModel: 'gemini-1.5-flash',
    mergeModel: 'gemini-1.5-flash',
    transcriptionModel: 'gemini-1.5-flash',
    reportModel: 'gemini-1.5-flash'
  };

  // Select models based on tier
  switch (tier) {
    case 'first':
      // Top tier uses Pro models for everything
      config = {
        screenshotModel: 'gemini-1.5-pro',
        audioModel: 'gemini-1.5-pro',
        mergeModel: 'gemini-1.5-pro',
        transcriptionModel: 'gemini-1.5-pro',
        reportModel: 'gemini-1.5-pro'
      };
      break;
    case 'business':
      // Business tier uses Pro for description/reports, Flash for transcription
      config = {
        screenshotModel: 'gemini-1.5-pro',
        audioModel: 'gemini-1.5-pro',
        mergeModel: 'gemini-1.5-pro',
        transcriptionModel: 'gemini-1.5-flash',
        reportModel: 'gemini-1.5-pro'
      };
      break;
    case 'economy':
      // Economy tier uses Flash models for everything
      config = {
        screenshotModel: 'gemini-1.5-flash',
        audioModel: 'gemini-1.5-flash',
        mergeModel: 'gemini-1.5-flash',
        transcriptionModel: 'gemini-1.5-flash',
        reportModel: 'gemini-1.5-flash'
      };
      break;
    case 'budget':
      // Budget tier uses Flash for description, Flash Lite for transcription/report
      config = {
        screenshotModel: 'gemini-1.5-flash',
        audioModel: 'gemini-1.5-flash',
        mergeModel: 'gemini-1.5-flash',
        transcriptionModel: 'gemini-pro',
        reportModel: 'gemini-pro'
      };
      break;
    case 'experimental':
      // Experimental tier - try new models
      config = {
        screenshotModel: 'models/gemini-1.5-pro-latest',
        audioModel: 'models/gemini-1.5-pro-latest',
        mergeModel: 'models/gemini-1.5-pro-latest',
        transcriptionModel: 'models/gemini-1.5-pro-latest',
        reportModel: 'models/gemini-1.5-pro-latest'
      };
      break;
  }

  return config;
}

/**
 * Extract media information from file
 */
async function getMediaInfo(filePath: string): Promise<{isVideo: boolean, duration: number}> {
  try {
    // Use ffprobe to get media info
    const output = await new Promise<string>((resolve, reject) => {
      exec(`ffprobe -v error -show_entries format=duration -of json "${filePath}"`, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });

    const data = JSON.parse(output);
    const duration = parseFloat(data.format.duration);

    // Check if it's a video by looking for video streams
    const videoCheck = await new Promise<string>((resolve, reject) => {
      exec(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of json "${filePath}"`, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });

    const videoData = JSON.parse(videoCheck);
    const isVideo = videoData.streams && videoData.streams.length > 0;

    return { 
      isVideo, 
      duration 
    };
  } catch (error) {
    console.error('Error getting media info:', error);
    return { 
      isVideo: false, 
      duration: 0 
    };
  }
}

/**
 * Generate screenshots from video
 */
async function generateScreenshots(filePath: string, outputDir: string, count: number): Promise<string[]> {
  const screenshotPaths: string[] = [];
  
  try {
    // Get video duration
    const mediaInfo = await getMediaInfo(filePath);
    if (!mediaInfo.isVideo || mediaInfo.duration <= 0) {
      console.log('Not a video or invalid duration, skipping screenshots');
      return screenshotPaths;
    }
    
    // Calculate screenshot intervals
    const interval = mediaInfo.duration / (count + 1);
    
    // Generate screenshots
    for (let i = 1; i <= count; i++) {
      const timestamp = interval * i;
      const outputPath = path.join(outputDir, `screenshot_${i}.jpg`);
      
      await new Promise<void>((resolve, reject) => {
        exec(`ffmpeg -ss ${timestamp} -i "${filePath}" -vframes 1 -q:v 2 "${outputPath}"`, (error) => {
          if (error) {
            console.error(`Error generating screenshot ${i}:`, error);
            reject(error);
          } else {
            screenshotPaths.push(outputPath);
            resolve();
          }
        });
      });
    }
    
    return screenshotPaths;
  } catch (error) {
    console.error('Error generating screenshots:', error);
    return screenshotPaths;
  }
}

/**
 * Generate content description from media
 */
async function generateContentDescription(
  filePath: string,
  outputDir: string,
  mediaInfo: {isVideo: boolean, duration: number},
  screenshotPaths: string[],
  apiKey: string,
  screenshotModel: string,
  audioModel: string,
  mergeModel: string,
  instructions?: string,
  audioChunkMinutes: number = 10
): Promise<string> {
  console.log('Calling generateDescription with models:', { screenshotModel, audioModel, mergeModel });
  
  // Call the existing generateDescription function with the right parameters
  const descriptionResult = await generateDescription(filePath, {
    screenshotModel,
    audioModel,
    mergeModel,
    screenshotCount: screenshotPaths.length,
    transcriptionChunkMinutes: audioChunkMinutes,
    outputPath: outputDir,
    showProgress: true,
    userInstructions: instructions,
    apiKey
  });
  
  return descriptionResult.finalDescription;
}

/**
 * Generate technical report
 */
async function generateTechnicalReport(
  filePath: string,
  outputDir: string,
  mediaInfo: {isVideo: boolean, duration: number},
  description: string,
  transcription: string,
  apiKey: string,
  reportModel: string
): Promise<{report: string, reportPath: string}> {
  console.log('Generating technical report with model:', reportModel);
  
  // Create a name for the report file
  const reportFile = path.basename(filePath, path.extname(filePath)) + '_report';
  
  // Call the existing generateReport function
  const reportResult = await generateReport(
    description,
    transcription,
    {
      model: reportModel,
      outputPath: outputDir,
      reportName: reportFile,
      showProgress: true,
      apiKey
    }
  );
  
  // Read the report content from the file
  const reportContent = fs.readFileSync(reportResult.reportPath, 'utf-8');
  
  return {
    report: reportContent,
    reportPath: reportResult.reportPath
  };
}