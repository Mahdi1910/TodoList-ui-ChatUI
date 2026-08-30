import { bindCardActions } from './card-actions.js';
import { showToast } from './toast.js';
import { enhanceTranscription } from './gemini-rest.js';
import { isRTL, applyTextDirection } from './rtl-detect.js';
import { attachMetadataToEntry } from './metadata-fetcher.js';
import { saveEntry, updateEntry, saveAudioFile } from './database.js';
import { processRetryQueue } from './retry-manager.js';
import { updateDateDisplay, getActiveDateString } from '../state.js';

// Shared state for the microphone module
let audioContext = null;
let audioWorkletNode = null;
let mediaStream = null;
let websocket = null;
let isRecording = false;
let audioBufferQueue = [];
let currentTranscript = "";
let mediaRecorder = null;
let audioChunks = [];

function floatTo16BitPCM(input) {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunk = 8192;
    for (let i = 0; i < len; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function sendAudioChunk(base64Chunk) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            realtimeInput: {
                audio: {
                    data: base64Chunk,
                    mimeType: "audio/pcm;rate=16000"
                }
            }
        }));
    }
}

export async function startRecording() {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        showToast('<i class="fa-solid fa-key" style="color: #ef4444;"></i> Please set your Gemini API Key in Settings first.');
        return false;
    }

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Setup MediaRecorder for saving the raw audio
        audioChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.start();

        // Note: Many browsers require AudioContext to be created/resumed after a user gesture.
        // Since this is inside a click handler, it is safe.
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass({ sampleRate: 16000 });
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        // Setup AudioWorklet via an inline Blob
        const workletCode = `
        class AudioProcessor extends AudioWorkletProcessor {
            process(inputs) {
                const input = inputs[0];
                if (input.length > 0) {
                    const channelData = input[0];
                    this.port.postMessage(channelData);
                }
                return true;
            }
        }
        registerProcessor('audio-processor', AudioProcessor);
        `;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await audioContext.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        
        // Connect to a GainNode with 0 gain to prevent playback/echo
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0; 
        
        source.connect(audioWorkletNode);
        audioWorkletNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        isRecording = true;
        currentTranscript = "";
        audioBufferQueue = [];

        // Connect WebSocket
        const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
        websocket = new WebSocket(wsUrl);

        websocket.onopen = () => {
            console.log("Gemini Live WebSocket Connected");
            const configMessage = {
                setup: {
                    model: "models/gemini-3.1-flash-live-preview",
                    generationConfig: {
                        responseModalities: ["AUDIO"]
                    },
                    inputAudioTranscription: {}
                }
            };
            
            // Try sending as setup, and if the API expects config we'll send both to be safe, but setup is the standard wrapper for BidiGenerateContentSetup
            websocket.send(JSON.stringify({
                setup: {
                    model: "models/gemini-3.1-flash-live-preview",
                    systemInstruction: {
                        parts: [{text: "You must always respond with exactly the word 'Done' and nothing else. Do not provide any commentary, reactions, or transcription. Just say 'Done'."}]
                    },
                    generationConfig: {
                        responseModalities: ["AUDIO"]
                    },
                    realtimeInputConfig: {
                        automaticActivityDetection: { disabled: true }
                    },
                    inputAudioTranscription: {}
                }
            }));
            // Send activityStart to begin the audio turn since VAD is disabled
            websocket.send(JSON.stringify({
                realtimeInput: {
                    activityStart: {}
                }
            }));
            
            // Flush buffered audio
            while (audioBufferQueue.length > 0) {
                const chunk = audioBufferQueue.shift();
                sendAudioChunk(chunk);
            }
        };

        websocket.onmessage = async (event) => {
            try {
                let textData = event.data;
                if (textData instanceof Blob) {
                    textData = await textData.text();
                }
                
                const response = JSON.parse(textData);
                // Listen for transcriptions streaming in
                if (response.serverContent && response.serverContent.inputTranscription) {
                    const txt = response.serverContent.inputTranscription.text;
                    if (txt && txt.trim().length > 0) {
                        // Accumulate the transcript chunks so we don't overwrite if the API sends multiple parts
                        if (currentTranscript.length > 0) {
                            currentTranscript += " " + txt.trim();
                        } else {
                            currentTranscript = txt.trim();
                        }
                    }
                }
            } catch (err) {
                console.error("Error parsing WebSocket message:", err);
            }
        };

        websocket.onerror = (err) => {
            console.error("WebSocket error:", err);
        };

        audioWorkletNode.port.onmessage = (e) => {
            if (!isRecording) return;
            const inputData = e.data; // This is the Float32Array from the worklet
            const pcmBuffer = floatTo16BitPCM(inputData);
            const base64Chunk = arrayBufferToBase64(pcmBuffer);
            
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                sendAudioChunk(base64Chunk);
            } else {
                // Buffer chunks while waiting for connection
                audioBufferQueue.push(base64Chunk);
            }
        };
        
        return true;
    } catch (err) {
        console.error("Audio error:", err);
        if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
            alert("Microphone access is blocked on mobile HTTP.\n\nTo test locally, go to chrome://flags/#unsafely-treat-insecure-origin-as-secure in your mobile browser, add '" + window.location.href + "', and enable it.");
        } else {
            showToast('<i class="fa-solid fa-microphone-slash" style="color: #ef4444;"></i> Microphone access denied.');
        }
        return false;
    }
}

export async function stopRecording() {
    isRecording = false;
    
    if (audioWorkletNode) audioWorkletNode.disconnect();
    if (audioContext) await audioContext.close();

    // Send activityEnd since VAD is disabled to tell the server the turn is complete
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            realtimeInput: {
                activityEnd: {}
            }
        }));
    }
    
    return new Promise(resolve => {
        let finalAudioBlob = null;
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.onstop = () => {
                finalAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
            };
            mediaRecorder.stop();
        } else {
            finalAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
        }

        let elapsed = 0;
        const interval = setInterval(() => {
            elapsed += 100;
            // Wait for the blob to be generated too
            if ((currentTranscript || elapsed >= 2500) && finalAudioBlob) {
                clearInterval(interval);
                if (websocket) {
                    websocket.close();
                }
                resolve({
                    transcript: currentTranscript.trim(),
                    audioBlob: finalAudioBlob
                });
            }
            
            // Failsafe timeout to prevent infinite loop
            if (elapsed >= 5000) {
                clearInterval(interval);
                if (websocket) websocket.close();
                resolve({
                    transcript: currentTranscript ? currentTranscript.trim() : "",
                    audioBlob: finalAudioBlob || new Blob([], { type: 'audio/webm' })
                });
            }
        }, 100);
    });
}

export function initMicrophone() {
    const micBtn = document.getElementById('mic-btn');
    const micStatus = document.getElementById('mic-status');
    const entriesContainer = document.getElementById('entries-container');
    const emptyState = document.getElementById('empty-state');
    const manualBtn = document.getElementById('manual-entry-btn');
    
    let currentState = 'blue';

    if (micBtn) {
        micBtn.addEventListener('click', async (e) => {
            if (currentState === 'blue') {
                const started = await startRecording();
                if (!started) return;

                currentState = 'red';
                micBtn.className = 'state-red';
                micBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
                micStatus.textContent = 'Recording... Tap to stop';
                micStatus.style.color = '#ef4444';
            }
            else if (currentState === 'red') {
                currentState = 'yellow';
                micBtn.className = 'state-yellow';
                micBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                micStatus.textContent = 'Processing Transcription...';
                micStatus.style.color = '#f59e0b';
                
                const finalTranscript = await stopRecording();
                handleFinalTranscript(finalTranscript);
            }
        });
    }

    async function handleFinalTranscript(result) {
        currentState = 'blue';
        micBtn.className = 'state-blue';
        micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        micStatus.textContent = 'Ready to record';
        micStatus.style.color = 'var(--text-muted)';

        const rawText = result.transcript;
        const audioBlob = result.audioBlob;
        
        const now = new Date();
        const localDateString = getActiveDateString();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const entryId = crypto.randomUUID();

        // Check if transcription failed
        if (!rawText) {
            // Save Audio anyway!
            await saveAudioFile(entryId, audioBlob);
            await saveEntry({
                id: entryId,
                title: "Failed Transcription",
                content: "",
                local_date: localDateString,
                time_string: timeString,
                status: "failed_transcription",
                audio_file_id: entryId
            });
            updateDateDisplay();
            showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> Transcription failed. Saved for retry.');
            attachMetadataToEntry(entryId);
            return;
        }

        const dir = isRTL(rawText) ? 1 : 0;
        
        // Save Audio
        await saveAudioFile(entryId, audioBlob);

        // Create Database Entry
        const entry = await saveEntry({
            id: entryId,
            content: rawText,
            is_rtl: dir,
            local_date: localDateString,
            time_string: timeString,
            status: "enhancing",
            audio_file_id: entryId
        });

        // Trigger Auto-Backup 10 seconds after raw transcription completes
        const autoBackupFreq = localStorage.getItem('auto_backup_frequency');
        if (autoBackupFreq === '10s_after_transcription') {
            setTimeout(() => {
                import('./settings.js').then(module => {
                    module.performBackup(true).catch(err => console.error("Auto backup after 10s failed:", err));
                });
            }, 10000);
        }

        // Re-render feed so the user sees the placeholder
        updateDateDisplay();

        // Fire asynchronous metadata gathering
        attachMetadataToEntry(entry.id);

        // Enhance Transcription using Gemma
        const apiKey = localStorage.getItem('gemini_api_key');
        if (apiKey) {
            const enhancedData = await enhanceTranscription(rawText, apiKey);
            if (enhancedData) {
                await updateEntry(entry.id, {
                    title: enhancedData.title,
                    tags: enhancedData.tags,
                    content: enhancedData.improvedText,
                    is_rtl: isRTL(enhancedData.improvedText) ? 1 : 0,
                    status: "completed"
                });
                
                // Trigger auto-retry logic!
                processRetryQueue();
            } else {
                await updateEntry(entry.id, {
                    status: "failed_enhancement",
                    title: "Failed Enhancement"
                });
                showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> Failed to enhance transcription.');
            }
        } else {
            await updateEntry(entry.id, { status: "completed" });
            processRetryQueue();
        }
        
        // Refresh the UI to show final output
        updateDateDisplay();
    }

    if (manualBtn) {
        manualBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const container = document.getElementById('entries-container');
            const emptyState = document.getElementById('empty-state');
            if (emptyState) emptyState.style.display = 'none';

            const entryId = crypto.randomUUID();
            
            const cardHTML = `
            <div class="diary-card editing" id="${entryId}" data-is-new="true">
                <div class="card-header">
                    <div class="card-meta">
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; width: 100%; margin-bottom: 12px;">
                            <input type="text" class="edit-gps-input" value="" placeholder="Location" style="flex: 1; min-width: 120px; font-size: 13px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 6px; border-radius: 6px; outline: none;">
                            <input type="text" class="edit-weather-input" value="" placeholder="Weather" style="flex: 1; min-width: 100px; font-size: 13px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 6px; border-radius: 6px; outline: none;">
                            <input type="text" class="edit-tags-input" value="" placeholder="Tags (comma separated)" style="flex: 2; min-width: 150px; font-size: 13px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 6px; border-radius: 6px; outline: none;">
                        </div>
                    </div>
                </div>
                <div class="card-body">
                    <h3><input type="text" class="edit-title-input" value="" placeholder="Title" style="width: 100%; font-size: 1.25rem; font-weight: 600; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 8px; border-radius: 8px; outline: none; margin-bottom: 8px;"></h3>
                    <p><textarea class="edit-text-input" placeholder="Write your thoughts here..." style="width: 100%; font-size: 15px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 12px; border-radius: 8px; outline: none; resize: vertical; min-height: 100px;"></textarea>
                    <div style="display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;">
                        <button class="settings-btn cancel-edit-btn" style="padding: 6px 12px; border: none;">Cancel</button>
                        <button class="settings-btn save-edit-btn" style="background: var(--accent); color: white; border: none; padding: 6px 16px;">Save</button>
                    </div></p>
                </div>
            </div>`;

            // Prepend so it shows at the top, since new items usually go top or bottom? 
            // In Aura Diary it seems entries are prepended natively or maybe we should just append it?
            // Actually, wait, updateDateDisplay renders from Dexie, which fetches them based on sort. 
            // Let's prepend it so it's immediately visible at the top!
            container.insertAdjacentHTML('afterbegin', cardHTML);
            
            const newCard = document.getElementById(entryId);
            const textInput = newCard.querySelector('.edit-text-input');
            const cancelBtn = newCard.querySelector('.cancel-edit-btn');
            const saveBtn = newCard.querySelector('.save-edit-btn');

            // Scroll to top to see the new prepended entry
            const scrollContainer = document.querySelector('.scrollable-content');
            if (scrollContainer) scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });

            // Synchronously focus to automatically open the software keyboard!
            if (textInput) textInput.focus();

            cancelBtn.addEventListener('click', () => {
                newCard.remove();
                if (container.children.length === 0 && emptyState) emptyState.style.display = 'block';
            });

            saveBtn.addEventListener('click', async () => {
                const titleInput = newCard.querySelector('.edit-title-input');
                const gpsInput = newCard.querySelector('.edit-gps-input');
                const weatherInput = newCard.querySelector('.edit-weather-input');
                const tagsInput = newCard.querySelector('.edit-tags-input');

                const newTitle = titleInput.value.trim() || "Untitled";
                const newText = textInput.value.trim();
                if (!newText) {
                    showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> Entry cannot be empty');
                    return;
                }

                const newGps = gpsInput.value.trim();
                const newWeather = weatherInput.value.trim();
                const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);

                const now = new Date();
                const localDateString = getActiveDateString();
                const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                await saveEntry({
                    id: entryId,
                    title: newTitle,
                    content: newText,
                    location_city: newGps,
                    weather_condition: newWeather,
                    tags: newTags,
                    local_date: localDateString,
                    time_string: timeString,
                    status: "completed",
                    is_rtl: isRTL(newText) ? 1 : 0
                });
                
                showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> Saved manually');
                updateDateDisplay();
            });
        });
    }
}
