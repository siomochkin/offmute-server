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
        
        // Update button state - make API key optional
        processBtn.disabled = !(isFileSelected && isOptionSelected);
        
        return isFileSelected && isOptionSelected;
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
            // Create FormData object
            const formData = new FormData();
            formData.append('file', selectedFile);
            
            // Add processing options from advanced settings
            formData.append('tier', tierSelect.value);
            formData.append('screenshotCount', screenshotCount.value);
            formData.append('audioChunkMinutes', audioChunkMinutes.value);
            formData.append('generateReport', technicalReportCheckbox.checked ? 'true' : 'false');
            formData.append('streamResponse', streamResponse.checked ? 'true' : 'false');
            
            // Add optional parameters if provided
            if (instructions.value.trim()) {
                formData.append('instructions', instructions.value.trim());
            }
            
            // Only append API key if provided in the form
            if (apiKey.value.trim()) {
                formData.append('apiKey', apiKey.value.trim());
            }
            
            // Start the request
            updateProgress(5, 'Starting processing...');
            
            const response = await fetch('/api/process', {
                method: 'POST',
                body: formData,
                signal
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                if (errorData && errorData.code === 'FILE_TOO_LARGE') {
                    throw new Error('File too large. Maximum file size is 2GB.');
                } else if (response.status === 413) {
                    throw new Error('File too large. The server rejected the upload.');
                } else {
                    throw new Error(`Server responded with ${response.status}: ${response.statusText || errorData?.error || 'Unknown error'}`);
                }
            }
            
            // Check if streaming response is enabled
            if (streamResponse.checked) {
                // For streaming response, set up event source
                const reader = response.body.getReader();
                let receivedLength = 0;
                let chunks = [];
                let lastProgressUpdate = Date.now();
                
                while(true) {
                    const {done, value} = await reader.read();
                    
                    if (done) {
                        break;
                    }
                    
                    chunks.push(value);
                    receivedLength += value.length;
                    
                    // Parse the chunks as they come in
                    const text = new TextDecoder().decode(value);
                    
                    // Server-sent events format parsing
                    const events = text.split('\n\n');
                    for (const event of events) {
                        if (event.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(event.substring(6));
                                handleStreamUpdate(data);
                            } catch (e) {
                                console.warn('Error parsing SSE data:', e);
                            }
                        }
                    }
                    
                    // Update progress every second at most
                    const now = Date.now();
                    if (now - lastProgressUpdate > 1000) {
                        // This is a simple progress indication based on received data
                        updateProgress(Math.min(receivedLength / 1000, 95), 'Processing...');
                        lastProgressUpdate = now;
                    }
                }
                
                // Final progress update
                updateProgress(100, 'Processing complete!');
            } else {
                // Non-streaming response - poll for status
                const responseData = await response.json();
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
        // Save the job ID for later use
        if (data.jobId) {
            currentJobId = data.jobId;
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
                }
                break;
            case 'transcription_complete':
                if (!data.progress) {
                    updateProgress(80, 'Transcription complete, generating report...');
                }
                // Update with transcription data
                if (data.transcription) {
                    displayPartialResults({ 
                        contentDescription: data.description,
                        transcription: data.transcription 
                    });
                }
                break;
            case 'completed':
                if (!data.progress) {
                    updateProgress(100, 'Processing complete!');
                }
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
            technicalReportResult.classList.remove('hidden');
            const content = technicalReportResult.querySelector('.result-content');
            content.innerHTML = `<p>${result.report}</p>`;
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