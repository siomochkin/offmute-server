import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { generateDescription, generateTranscription, generateReport } from './index';
import { GenerateReportResult } from './report';
import crypto from 'crypto';

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

// Process video/audio file with streaming response
app.post('/api/process', uploadHandler, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate API key - first from request, then from env
    const apiKey = req.body.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ 
        error: 'Missing API key. You must provide a Google Gemini API key either in the request or as an environment variable.',
        code: 'MISSING_API_KEY'
      });
    }

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

    // Select models based on tier - using the actual available model names
    let screenshotModel = 'gemini-1.5-flash';
    let audioModel = 'gemini-1.5-flash';
    let mergeModel = 'gemini-1.5-flash';
    let transcriptionModel = 'gemini-1.5-flash';
    let reportModel = 'gemini-1.5-flash';
    
    // Validate tier
    const validTiers = ['first', 'business', 'economy', 'budget', 'experimental'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({
        error: `Invalid tier. Must be one of: ${validTiers.join(', ')}`,
        code: 'INVALID_TIER'
      });
    }

    // Select models based on tier
    switch (tier) {
      case 'first':
        // Top tier uses Pro models for everything
        screenshotModel = 'gemini-1.5-pro';
        audioModel = 'gemini-1.5-pro';
        mergeModel = 'gemini-1.5-pro';
        transcriptionModel = 'gemini-1.5-pro';
        reportModel = 'gemini-1.5-pro';
        break;
      case 'business':
        // Business tier uses Pro for description/reports, Flash for transcription
        screenshotModel = 'gemini-1.5-pro';
        audioModel = 'gemini-1.5-pro';
        mergeModel = 'gemini-1.5-pro';
        transcriptionModel = 'gemini-1.5-flash';
        reportModel = 'gemini-1.5-pro';
        break;
      case 'economy':
        // Economy tier uses Flash models for everything
        screenshotModel = 'gemini-1.5-flash';
        audioModel = 'gemini-1.5-flash';
        mergeModel = 'gemini-1.5-flash';
        transcriptionModel = 'gemini-1.5-flash';
        reportModel = 'gemini-1.5-flash';
        break;
      case 'budget':
        // Budget tier uses Flash for description, Flash Lite for transcription/report
        screenshotModel = 'gemini-1.5-flash';
        audioModel = 'gemini-1.5-flash';
        mergeModel = 'gemini-1.5-flash';
        transcriptionModel = 'gemini-pro';
        reportModel = 'gemini-pro';
        break;
      case 'experimental':
        // Experimental tier - try new models
        screenshotModel = 'models/gemini-1.5-pro-latest';
        audioModel = 'models/gemini-1.5-pro-latest';
        mergeModel = 'models/gemini-1.5-pro-latest';
        transcriptionModel = 'models/gemini-1.5-pro-latest';
        reportModel = 'models/gemini-1.5-pro-latest';
        break;
    }
    
    console.log('Using models:', {
      screenshotModel,
      audioModel,
      mergeModel,
      transcriptionModel,
      reportModel
    });

    // Generate a secure job ID with crypto randomness
    const randomBytes = crypto.randomBytes(16).toString('hex');
    const jobId = `${Date.now()}-${randomBytes}`;
    
    // Create output directory with sanitized path to prevent path traversal
    const sanitizedFileName = path.basename(filePath, path.extname(filePath))
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    
    const outputDir = path.join(__dirname, '../uploads', `${jobId}-${sanitizedFileName}`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Save job info - don't store API key
    fs.writeFileSync(
      path.join(outputDir, 'job.json'),
      JSON.stringify({
        jobId,
        status: 'processing',
        inputFile: req.file.originalname,
        startedAt: new Date().toISOString(),
        parameters: {
          tier,
          screenshotCount,
          audioChunkMinutes,
          generateReport: generateReportFlag,
          streamResponse,
          hasCustomInstructions: !!instructions
        }
      }, null, 2)
    );
    
    // For non-streaming response, immediately return job info
    if (!streamResponse) {
      res.json({
        message: 'Processing started',
        jobId,
        status: 'processing',
        inputFile: req.file.originalname
      });
      
      // Continue processing in the background
      (async () => {
        try {
          // Step 1: Generate description
          const description = await generateDescription(filePath, {
            screenshotModel,
            audioModel,
            mergeModel,
            screenshotCount,
            transcriptionChunkMinutes: audioChunkMinutes,
            descriptionChunkMinutes: audioChunkMinutes * 2,
            outputPath: outputDir,
            showProgress: true,
            userInstructions: instructions,
            apiKey,
          });

          // Save intermediate description result
          const intermediateResult = {
            jobId,
            status: 'description_complete',
            inputFile: req.file ? req.file.originalname : path.basename(filePath),
            outputs: {
              descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
            },
            downloadLinks: {
              description: `/api/results/${jobId}/description`,
            },
            transcription: {
              status: 'in_progress'
            }
          };

          fs.writeFileSync(
            path.join(outputDir, 'result.json'),
            JSON.stringify(intermediateResult, null, 2)
          );

          // Step 2: Generate transcription
          const transcription = await generateTranscription(filePath, description, {
            transcriptionModel,
            outputPath: outputDir,
            showProgress: true,
            userInstructions: instructions,
            apiKey,
          });

          // Update with transcription result
          const transcriptionResult = {
            jobId,
            status: 'transcription_complete',
            inputFile: req.file ? req.file.originalname : path.basename(filePath),
            outputs: {
              descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
              transcriptionFile: path.relative(path.join(__dirname, '..'), transcription.transcriptionPath),
            },
            downloadLinks: {
              description: `/api/results/${jobId}/description`,
              transcription: `/api/results/${jobId}/transcription`,
            },
            report: generateReportFlag ? { status: 'in_progress' } : { status: 'not_requested' }
          };

          fs.writeFileSync(
            path.join(outputDir, 'result.json'),
            JSON.stringify(transcriptionResult, null, 2)
          );

          // Step 3: Generate report if requested
          let report: GenerateReportResult | undefined = undefined;
          if (generateReportFlag) {
            console.log('Generating report...');
            try {
              report = await generateReport(
                description.finalDescription,
                transcription.chunkTranscriptions.join('\n\n'),
                {
                  model: reportModel,
                  outputPath: outputDir,
                  reportName: 'meeting_summary',
                  showProgress: true,
                  userInstructions: instructions,
                  apiKey,
                }
              );
              console.log('Report generated successfully:', report);
            } catch (reportError) {
              console.error('Error generating report:', reportError);
            }
          } else {
            console.log('Report generation skipped (not requested)');
          }

          // Create final result summary
          const resultSummary = {
            jobId,
            status: 'completed',
            inputFile: req.file ? req.file.originalname : path.basename(filePath),
            outputs: {
              descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
              transcriptionFile: path.relative(path.join(__dirname, '..'), transcription.transcriptionPath),
              reportFile: report ? path.relative(path.join(__dirname, '..'), report.reportPath) : null,
            },
            downloadLinks: {
              description: `/api/results/${jobId}/description`,
              transcription: `/api/results/${jobId}/transcription`,
              report: report ? `/api/results/${jobId}/report` : null,
            }
          };

          // Save result summary
          fs.writeFileSync(
            path.join(outputDir, 'result.json'),
            JSON.stringify(resultSummary, null, 2)
          );
        } catch (error) {
          console.error('Processing error:', error);
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
      })();
    }
  } catch (error) {
    console.error('Error processing upload:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
});

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