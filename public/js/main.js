// Global variables
let selectedFile = null;
let processing = false;
let uploadController = null;

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    const fileInput = document.getElementById('fileInput');
    const fileInfo = document.getElementById('fileInfo');
    const progressSection = document.getElementById('progressSection');
    const resultsSection = document.getElementById('resultsSection');
    const progressBar = document.querySelector('.progress-bar');
    const progressText = document.getElementById('progressText');
    const cancelBtn = document.getElementById('cancelBtn');
    const contentDescriptionCheckbox = document.getElementById('contentDescription');
    const transcriptionCheckbox = document.getElementById('transcription');
    const technicalReportCheckbox = document.getElementById('technicalReport');
    const contentDescriptionResult = document.getElementById('contentDescriptionResult');
    const transcriptionResult = document.getElementById('transcriptionResult');
    const technicalReportResult = document.getElementById('technicalReportResult');
    const newProcessButton = document.getElementById('newProcessButton');
    const downloadButton = document.getElementById('downloadButton');
    const uploadLabel = document.querySelector('.file-input-container label');
    const processBtn = document.getElementById('processBtn');
    const fileInputContainer = document.querySelector('.file-input-container');
    
    // Advanced options elements
    const advancedToggleBtn = document.getElementById('advancedToggleBtn');
    const advancedOptions = document.getElementById('advancedOptions');
    const tierSelect = document.getElementById('tierSelect');
    const screenshotCount = document.getElementById('screenshotCount');
    const audioChunkMinutes = document.getElementById('audioChunkMinutes');
    const instructions = document.getElementById('instructions');
    const apiKey = document.getElementById('apiKey');
    const streamResponse = document.getElementById('streamResponse');

    // Processing state
    let isProcessing = false;
    let abortController = null;
    let currentJobId = null;

    // Event listeners
    fileInput.addEventListener('change', handleFileSelection);
    cancelBtn.addEventListener('click', cancelProcessing);
    newProcessButton.addEventListener('click', resetForm);
    processBtn.addEventListener('click', processFile);
    downloadButton.addEventListener('click', downloadResults);
    
    // Toggle advanced options
    advancedToggleBtn.addEventListener('click', () => {
        const isHidden = advancedOptions.classList.contains('hidden');
        if (isHidden) {
            advancedOptions.classList.remove('hidden');
            advancedToggleBtn.textContent = 'Hide Advanced Options';
        } else {
            advancedOptions.classList.add('hidden');
            advancedToggleBtn.textContent = 'Show Advanced Options';
        }
    });
    
    // Checkbox listeners for enabling/disabling process button
    [contentDescriptionCheckbox, transcriptionCheckbox, technicalReportCheckbox].forEach(checkbox => {
        checkbox.addEventListener('change', updateSubmitButtonState);
    });

    // Add drag and drop functionality to file input
    setupDragAndDrop();

    // Initialize submit button state
    updateSubmitButtonState();

    // Function to validate form
    function validateForm() {
        // Check if file is selected
        const isFileSelected = !!selectedFile;
        
        // Check if at least one processing option is selected
        const isOptionSelected = contentDescriptionCheckbox.checked || 
                                 transcriptionCheckbox.checked || 
                                 technicalReportCheckbox.checked;
        
        // Check if API key is provided
        const isApiKeyProvided = apiKey.value.trim().length > 0;
        
        // Update button state - API key is now mandatory
        processBtn.disabled = !(isFileSelected && isOptionSelected && isApiKeyProvided);
        
        return isFileSelected && isOptionSelected && isApiKeyProvided;
    }

    // Add event listener for API key field
    apiKey.addEventListener('input', validateForm);

    /**
     * Setup drag and drop for the file input container
     */
    function setupDragAndDrop() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            fileInputContainer.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Add visual feedback
        ['dragenter', 'dragover'].forEach(eventName => {
            fileInputContainer.addEventListener(eventName, () => {
                fileInputContainer.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            fileInputContainer.addEventListener(eventName, () => {
                fileInputContainer.classList.remove('dragover');
            }, false);
        });

        // Handle the actual drop
        fileInputContainer.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length) {
                fileInput.files = files;
                handleFileSelection({ target: fileInput });
            }
        }, false);
    }

    /**
     * Formats file size into human-readable string
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted file size
     */
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Handles file selection from the input
     */
    function handleFileSelection(e) {
        const file = e.target.files[0];
        
        if (!file) {
            selectedFile = null;
            fileInfo.textContent = '';
            updateUI();
            return;
        }
        
        selectedFile = file;
        
        // Display file info with nicely formatted size
        const fileSizeMB = formatFileSize(file.size);
        fileInfo.innerHTML = `<strong>Selected File:</strong> ${file.name}<br>
                             <strong>Type:</strong> ${file.type}<br>
                             <strong>Size:</strong> ${fileSizeMB}`;
        
        updateUI();
    }

    /**
     * Process the selected file
     */
    async function processFile() {
        if (!selectedFile || isProcessing) return;
        
        // Check if at least one option is selected
        if (!contentDescriptionCheckbox.checked && !transcriptionCheckbox.checked && !technicalReportCheckbox.checked) {
            alert('Please select at least one processing option.');
            return;
        }

        // Check if file size is too large (over 2GB)
        if (selectedFile.size > 2 * 1024 * 1024 * 1024) {
            alert('File size exceeds 2GB limit. Please choose a smaller file.');
            return;
        }

        // Ensure API key is provided
        if (!apiKey.value.trim()) {
            alert('Please enter your Google Gemini API key.');
            return;
        }

        isProcessing = true;
        updateUI();
        
        // Create a new AbortController
        abortController = new AbortController();
        const signal = abortController.signal;

        // Clear previous results
        clearResults();
        
        // Show progress section
        progressSection.classList.remove('hidden');
        
        try {
            // Initialize upload
            updateProgress(5, 'Initializing upload...');
            
            // First create a job ID
            const initResponse = await fetch('/api/init-upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: selectedFile.name,
                    fileSize: selectedFile.size,
                    fileType: selectedFile.type,
                    
                    // Include processing options
                    tier: tierSelect.value,
                    screenshotCount: screenshotCount.value,
                    audioChunkMinutes: audioChunkMinutes.value,
                    generateReport: technicalReportCheckbox.checked ? 'true' : 'false',
                    streamResponse: streamResponse.checked ? 'true' : 'false',
                    
                    // Include API key and instructions if provided
                    apiKey: apiKey.value.trim(),
                    instructions: instructions.value.trim() || undefined
                }),
                signal
            });
            
            if (!initResponse.ok) {
                const errorData = await initResponse.json().catch(() => null);
                throw new Error(`Server error during initialization: ${initResponse.status}: ${errorData?.error || 'Unknown error'}`);
            }
            
            const { jobId, uploadUrls } = await initResponse.json();
            currentJobId = jobId;
            
            // Prepare for chunked upload
            const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
            const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
            
            updateProgress(10, `Uploading file in ${totalChunks} chunks...`);
            
            // Upload each chunk
            for (let chunk = 0; chunk < totalChunks; chunk++) {
                if (abortController.signal.aborted) {
                    throw new Error('Upload cancelled by user');
                }
                
                const start = chunk * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
                const fileChunk = selectedFile.slice(start, end);
                
                // Create form data for this chunk
                const formData = new FormData();
                formData.append('chunk', fileChunk);
                formData.append('chunkIndex', chunk.toString());
                formData.append('totalChunks', totalChunks.toString());
                
                // Upload this chunk
                const chunkResponse = await fetch(`/api/upload-chunk/${jobId}`, {
                    method: 'POST',
                    body: formData,
                    signal
                });
                
                if (!chunkResponse.ok) {
                    const errorData = await chunkResponse.json().catch(() => null);
                    throw new Error(`Error uploading chunk ${chunk+1}/${totalChunks}: ${errorData?.error || 'Unknown error'}`);
                }
                
                // Update progress based on uploaded chunks
                const uploadProgress = Math.floor(15 + ((chunk + 1) / totalChunks) * 20);
                updateProgress(uploadProgress, `Uploaded chunk ${chunk+1}/${totalChunks}`);
            }
            
            // Finalize the upload and start processing
            updateProgress(30, 'Upload complete, starting processing...');
            
            const processResponse = await fetch(`/api/process-uploaded/${jobId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    streamResponse: streamResponse.checked
                }),
                signal
            });
            
            if (!processResponse.ok) {
                const errorData = await processResponse.json().catch(() => null);
                if (errorData && errorData.code === 'FILE_TOO_LARGE') {
                    throw new Error('File too large. Maximum file size is 2GB.');
                } else if (processResponse.status === 413) {
                    throw new Error('File too large. The server rejected the upload.');
                } else {
                    throw new Error(`Server responded with ${processResponse.status}: ${processResponse.statusText || errorData?.error || 'Unknown error'}`);
                }
            }
            
            // Check if streaming response is enabled
            if (streamResponse.checked) {
                console.log('Using streaming response mode');
                // For streaming response, set up event source
                const reader = processResponse.body.getReader();
                let receivedLength = 0;
                let lastProgressUpdate = Date.now();
                let buffer = ''; // Buffer for incomplete messages
                
                while(true) {
                    const {done, value} = await reader.read();
                    
                    if (done) {
                        console.log('Stream reading complete');
                        break;
                    }
                    
                    receivedLength += value.length;
                    
                    // Parse the chunks as they come in
                    const text = new TextDecoder().decode(value);
                    console.log('Received chunk:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
                    
                    // Append to buffer
                    buffer += text;
                    
                    // Process complete events from buffer
                    const processBuffer = () => {
                        // Look for complete SSE messages (data: {...}\n\n)
                        const regex = /data: ({.*?})\n\n/gs;
                        let match;
                        let newBuffer = buffer;
                        let processedAny = false;
                        
                        while ((match = regex.exec(buffer)) !== null) {
                            processedAny = true;
                            try {
                                const jsonData = match[1];
                                console.log('Processing complete event data:', jsonData.substring(0, 100) + (jsonData.length > 100 ? '...' : ''));
                                const data = JSON.parse(jsonData);
                                handleStreamUpdate(data);
                                
                                // Remove processed part from buffer
                                newBuffer = newBuffer.substring(match.index + match[0].length);
                            } catch (e) {
                                console.warn('Error parsing SSE data:', e, 'Raw data:', match[1].substring(0, 100));
                            }
                        }
                        
                        if (processedAny) {
                            buffer = newBuffer;
                            return true;
                        }
                        return false;
                    };
                    
                    // Try to process any complete events
                    processBuffer();
                    
                    // Update progress every second at most
                    const now = Date.now();
                    if (now - lastProgressUpdate > 1000) {
                        // This is a simple progress indication based on received data
                        updateProgress(Math.min(receivedLength / 1000, 95), 'Processing...');
                        lastProgressUpdate = now;
                    }
                }
                
                // Process any remaining complete events in buffer
                if (buffer.length > 0) {
                    console.log('Processing remaining buffer data:', buffer.length, 'bytes');
                    const processBuffer = () => {
                        // Look for complete SSE messages
                        const regex = /data: ({.*?})\n\n/gs;
                        let match;
                        
                        while ((match = regex.exec(buffer)) !== null) {
                            try {
                                const jsonData = match[1];
                                console.log('Processing final buffered event:', jsonData.substring(0, 100) + (jsonData.length > 100 ? '...' : ''));
                                const data = JSON.parse(jsonData);
                                handleStreamUpdate(data);
                            } catch (e) {
                                console.warn('Error parsing final SSE data:', e);
                            }
                        }
                    };
                    
                    processBuffer();
                }
                
                // Final progress update
                updateProgress(100, 'Processing complete!');
            } else {
                // Non-streaming response - poll for status
                const responseData = await processResponse.json();
                currentJobId = responseData.jobId;
                
                // Start polling for job status
                await pollJobStatus(currentJobId);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                updateProgress(0, 'Processing cancelled');
            } else {
                console.error('Error during processing:', error);
                updateProgress(0, `Error: ${error.message}`);
            }
        } finally {
            isProcessing = false;
            abortController = null;
            updateUI();
        }
    }
    
    /**
     * Poll for job status for non-streaming requests
     */
    async function pollJobStatus(jobId) {
        if (!jobId) return;
        
        let completed = false;
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes max (5s interval)
        
        updateProgress(10, 'Processing started...');
        
        while (!completed && attempts < maxAttempts) {
            attempts++;
            try {
                const response = await fetch(`/api/jobs/${jobId}`);
                
                if (!response.ok) {
                    if (response.status === 404) {
                        // Job not found yet, continue polling
                        continue;
                    }
                    throw new Error(`Error checking job status: ${response.status}`);
                }
                
                const result = await response.json();
                
                // Update UI based on job status
                switch (result.status) {
                    case 'processing':
                        updateProgress(15, 'Processing audio...');
                        break;
                    case 'description_complete':
                        updateProgress(40, 'Description generated, working on transcription...');
                        if (result.description) {
                            displayPartialResults({ contentDescription: result.description });
                        }
                        break;
                    case 'transcription_complete':
                        updateProgress(80, 'Transcription complete, generating report...');
                        if (result.transcription) {
                            displayPartialResults({
                                contentDescription: result.description,
                                transcription: result.transcription
                            });
                        }
                        break;
                    case 'completed':
                        updateProgress(100, 'Processing complete!');
                        displayResults(result);
                        completed = true;
                        break;
                    case 'failed':
                        updateProgress(0, `Error: ${result.error || 'Unknown error occurred'}`);
                        completed = true;
                        break;
                }
                
                if (!completed) {
                    // Wait before next polling attempt
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (error) {
                console.error('Error polling job status:', error);
                // Continue polling despite errors
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        if (attempts >= maxAttempts) {
            updateProgress(0, 'Processing timed out. Please try again.');
        }
    }
    
    /**
     * Handle stream updates from server-sent events
     */
    function handleStreamUpdate(data) {
        console.log('Stream update received:', data.status);
        
        // Save the job ID for later use
        if (data.jobId) {
            currentJobId = data.jobId;
        }
        
        // Store received content globally for piecing together results
        if (!window.receivedContent) {
            window.receivedContent = {
                description: null,
                transcription: null,
                report: null
            };
        }
        
        // Handle individual content pieces
        if (data.status === 'description_content' && data.description) {
            console.log('Received full description content');
            window.receivedContent.description = data.description;
        }
        
        if (data.status === 'transcription_content' && data.transcription) {
            console.log('Received full transcription content');
            window.receivedContent.transcription = data.transcription;
        }
        
        if (data.status === 'report_content' && data.report) {
            console.log('Received full report content');
            window.receivedContent.report = data.report;
        }
        
        // When fully completed, use the stored content
        if (data.status === 'fully_completed') {
            console.log('Received final completion message');
            
            // Create a composite result from all received content
            const completeResult = {
                ...data,
                description: window.receivedContent.description || data.description,
                transcription: window.receivedContent.transcription || data.transcription,
                report: window.receivedContent.report || data.report
            };
            
            // Show the complete result
            displayResults(completeResult);
            
            // Reset stored content
            window.receivedContent = {
                description: null,
                transcription: null,
                report: null
            };
            
            // Stop processing
            return;
        }
        
        // Update progress based on progress value if provided
        if (data.progress !== undefined) {
            updateProgress(data.progress, data.message || progressText.textContent);
        }
        
        // Update progress based on status
        switch(data.status) {
            case 'processing':
                if (!data.progress) {
                    updateProgress(10, data.message || 'Processing started...');
                }
                break;
            case 'description_complete':
                if (!data.progress) {
                    updateProgress(40, 'Description generated, working on transcription...');
                }
                // If we have description data, show it right away
                if (data.description) {
                    displayPartialResults({ contentDescription: data.description });
                    // Store for later use
                    window.receivedContent.description = data.description;
                }
                break;
            case 'transcription_complete':
                if (!data.progress) {
                    updateProgress(80, 'Transcription complete, generating report...');
                }
                // Update with transcription data
                if (data.transcription) {
                    displayPartialResults({ 
                        contentDescription: window.receivedContent.description || data.description,
                        transcription: data.transcription 
                    });
                    // Store for later use
                    window.receivedContent.transcription = data.transcription;
                }
                break;
            case 'report_complete':
                if (!data.progress) {
                    updateProgress(90, 'Report complete, finalizing...');
                }
                // Show partial results with report
                if (data.report) {
                    displayPartialResults({
                        contentDescription: window.receivedContent.description || data.description,
                        transcription: window.receivedContent.transcription || data.transcription,
                        technicalReport: data.report
                    });
                    // Store for later use
                    window.receivedContent.report = data.report;
                }
                break;
            case 'completed':
                if (!data.progress) {
                    updateProgress(100, 'Processing complete!');
                }
                console.log('Received completed event with data:', 
                            'description:', !!data.description, 
                            'transcription:', !!data.transcription, 
                            'report:', !!data.report);
                            
                // Store any content we received
                if (data.description) window.receivedContent.description = data.description;
                if (data.transcription) window.receivedContent.transcription = data.transcription;
                if (data.report) window.receivedContent.report = data.report;
                
                // Show all results
                displayResults(data);
                break;
            case 'failed':
                updateProgress(0, `Error: ${data.error || 'Unknown error occurred'}`);
                break;
        }
    }

    /**
     * Display partial results while processing is ongoing
     */
    function displayPartialResults(data) {
        // Show the results section
        resultsSection.classList.remove('hidden');
        
        // Update results as they become available
        if (data.contentDescription) {
            contentDescriptionResult.classList.remove('hidden');
            const content = contentDescriptionResult.querySelector('.result-content');
            content.innerHTML = `<p>${data.contentDescription}</p>`;
        }
        
        if (data.transcription) {
            transcriptionResult.classList.remove('hidden');
            const content = transcriptionResult.querySelector('.result-content');
            content.innerHTML = `<p>${data.transcription}</p>`;
        }
        
        if (data.technicalReport) {
            console.log('Showing partial technical report');
            technicalReportResult.classList.remove('hidden');
            const content = technicalReportResult.querySelector('.result-content');
            
            // Format the report content for better display
            let formattedReport = data.technicalReport
                .replace(/^# (.*$)/gm, '<h1>$1</h1>')
                .replace(/^## (.*$)/gm, '<h2>$1</h2>')
                .replace(/^### (.*$)/gm, '<h3>$1</h3>');
                
            // Convert line breaks to HTML
            formattedReport = formattedReport.split('\n\n').map(p => `<p>${p}</p>`).join('');
            
            content.innerHTML = formattedReport;
        }
    }

    /**
     * Cancels the ongoing processing
     */
    function cancelProcessing() {
        if (isProcessing && abortController) {
            abortController.abort();
            updateProgress(0, 'Cancelling...');
        }
    }

    /**
     * Updates the progress bar and text
     */
    function updateProgress(percent, message) {
        progressBar.style.width = `${percent}%`;
        progressText.textContent = message;
    }

    /**
     * Displays results in the results section
     */
    function displayResults(result) {
        console.log('Displaying results:', result);
        resultsSection.classList.remove('hidden');
        
        // Content Description
        if (result.description) {
            contentDescriptionResult.classList.remove('hidden');
            const content = contentDescriptionResult.querySelector('.result-content');
            content.innerHTML = `<p>${result.description}</p>`;
        }
        
        // Transcription
        if (result.transcription) {
            transcriptionResult.classList.remove('hidden');
            const content = transcriptionResult.querySelector('.result-content');
            content.innerHTML = `<p>${result.transcription}</p>`;
        }
        
        // Report
        if (result.report) {
            console.log('Report content available, length:', result.report.length);
            technicalReportResult.classList.remove('hidden');
            const content = technicalReportResult.querySelector('.result-content');
            
            // Format the report content for better display
            // Convert markdown headings to HTML
            let formattedReport = result.report
                .replace(/^# (.*$)/gm, '<h1>$1</h1>')
                .replace(/^## (.*$)/gm, '<h2>$1</h2>')
                .replace(/^### (.*$)/gm, '<h3>$1</h3>');
                
            // Convert line breaks to HTML
            formattedReport = formattedReport.split('\n\n').map(p => `<p>${p}</p>`).join('');
            
            content.innerHTML = formattedReport;
            console.log('Report displayed with formatting');
        } else {
            console.log('No report data available in result:', result);
        }
    }

    /**
     * Download results as markdown files
     */
    function downloadResults() {
        if (!currentJobId) return;
        
        // Create a notification element
        const notification = document.createElement('div');
        notification.className = 'download-notification';
        notification.innerHTML = '<div class="download-spinner"></div><span>Preparing downloads...</span>';
        document.body.appendChild(notification);
        
        // Define the URLs
        const urls = [];
        
        // Check which results are available and add their URLs
        if (contentDescriptionCheckbox.checked && !contentDescriptionResult.classList.contains('hidden')) {
            urls.push({
                url: `/api/results/${currentJobId}/description`,
                name: 'description.md'
            });
        }
        
        if (transcriptionCheckbox.checked && !transcriptionResult.classList.contains('hidden')) {
            urls.push({
                url: `/api/results/${currentJobId}/transcription`,
                name: 'transcription.md'
            });
        }
        
        if (technicalReportCheckbox.checked && !technicalReportResult.classList.contains('hidden')) {
            urls.push({
                url: `/api/results/${currentJobId}/report`,
                name: 'report.md'
            });
        }
        
        // Update notification text based on the number of downloads
        notification.querySelector('span').textContent = `Downloading ${urls.length} file${urls.length !== 1 ? 's' : ''}...`;
        
        // Start downloads with a slight delay between each
        let downloadCount = 0;
        
        if (urls.length === 0) {
            notification.querySelector('span').textContent = 'No files to download';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 2000);
            return;
        }
        
        urls.forEach((item, index) => {
            setTimeout(() => {
                const link = document.createElement('a');
                link.href = item.url;
                link.download = item.name;
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                downloadCount++;
                if (downloadCount === urls.length) {
                    notification.querySelector('span').textContent = 'Downloads complete!';
                    setTimeout(() => {
                        document.body.removeChild(notification);
                    }, 2000);
                }
            }, index * 800); // Stagger downloads by 800ms
        });
    }

    /**
     * Clears all result containers
     */
    function clearResults() {
        resultsSection.classList.add('hidden');
        
        const resultContainers = document.querySelectorAll('.result-container');
        resultContainers.forEach(container => {
            container.classList.add('hidden');
            const content = container.querySelector('.result-content');
            content.innerHTML = '';
        });
    }

    /**
     * Updates UI based on current state
     */
    function updateUI() {
        processBtn.disabled = !selectedFile || isProcessing;
        cancelBtn.disabled = !isProcessing;
        
        if (isProcessing) {
            uploadLabel.classList.add('disabled');
            fileInput.disabled = true;
            contentDescriptionCheckbox.disabled = true;
            transcriptionCheckbox.disabled = true;
            technicalReportCheckbox.disabled = true;
            
            // Disable advanced options
            tierSelect.disabled = true;
            screenshotCount.disabled = true;
            audioChunkMinutes.disabled = true;
            instructions.disabled = true;
            apiKey.disabled = true;
            streamResponse.disabled = true;
            advancedToggleBtn.disabled = true;
        } else {
            uploadLabel.classList.remove('disabled');
            fileInput.disabled = false;
            contentDescriptionCheckbox.disabled = false;
            transcriptionCheckbox.disabled = false;
            technicalReportCheckbox.disabled = false;
            
            // Enable advanced options
            tierSelect.disabled = false;
            screenshotCount.disabled = false;
            audioChunkMinutes.disabled = false;
            instructions.disabled = false;
            apiKey.disabled = false;
            streamResponse.disabled = false;
            advancedToggleBtn.disabled = false;
        }
    }
    
    /**
     * Updates the submit button's disabled state based on form validity
     */
    function updateSubmitButtonState() {
        // Enable button only if a file is selected AND at least one option is checked
        const fileSelected = selectedFile !== null;
        const optionSelected = contentDescriptionCheckbox.checked || 
                               transcriptionCheckbox.checked || 
                               technicalReportCheckbox.checked;
        
        processBtn.disabled = !fileSelected || !optionSelected || isProcessing;
    }

    /**
     * Resets the form and views to initial state
     */
    function resetForm() {
        // Reset global variables
        selectedFile = null;
        isProcessing = false;
        currentJobId = null;
        
        // Reset DOM elements
        fileInput.value = '';
        fileInfo.innerHTML = '';
        contentDescriptionCheckbox.checked = true; // Default checked
        transcriptionCheckbox.checked = true; // Default checked
        technicalReportCheckbox.checked = false;
        
        // Reset advanced options
        tierSelect.value = 'business';
        screenshotCount.value = '4';
        audioChunkMinutes.value = '10';
        instructions.value = '';
        apiKey.value = '';
        streamResponse.checked = true;
        
        // Hide advanced options
        advancedOptions.classList.add('hidden');
        advancedToggleBtn.textContent = 'Show Advanced Options';
        
        // Reset view state
        progressSection.classList.add('hidden');
        resultsSection.classList.add('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = 'Starting...';
        
        // Update UI state
        updateUI();
        updateSubmitButtonState();
    }
}); 