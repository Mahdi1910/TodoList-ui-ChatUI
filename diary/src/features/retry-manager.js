import { db, getEntryById, updateEntry, getAudioFile } from './database.js';
import { enhanceTranscription } from './gemini-rest.js';
import { isRTL } from './rtl-detect.js';
import { updateDateDisplay } from '../state.js';
import { showToast } from './toast.js';

let isQueueProcessing = false;

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
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export async function retryAudioTranscriptionOverWebSocket(audioBlob, apiKey) {
    return new Promise(async (resolve) => {
        try {
            // Decode the audio blob into PCM
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContextClass({ sampleRate: 16000 });
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const inputData = audioBuffer.getChannelData(0);
            
            // Connect to Gemini Live
            const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
            const websocket = new WebSocket(wsUrl);
            let currentTranscript = "";
            let isModelDone = false;

            websocket.onopen = () => {
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

                websocket.send(JSON.stringify({
                    realtimeInput: { activityStart: {} }
                }));

                // Stream the audio data in chunks of 4096 samples
                const chunkSize = 4096;
                for (let i = 0; i < inputData.length; i += chunkSize) {
                    const chunk = inputData.slice(i, i + chunkSize);
                    const pcmBuffer = floatTo16BitPCM(chunk);
                    const base64Chunk = arrayBufferToBase64(pcmBuffer);
                    
                    websocket.send(JSON.stringify({
                        realtimeInput: {
                            audio: {
                                data: base64Chunk,
                                mimeType: "audio/pcm;rate=16000"
                            }
                        }
                    }));
                }

                websocket.send(JSON.stringify({
                    realtimeInput: { activityEnd: {} }
                }));
            };

            websocket.onmessage = async (event) => {
                try {
                    let textData = event.data;
                    if (textData instanceof Blob) {
                        textData = await textData.text();
                    }
                    const response = JSON.parse(textData);
                    
                    if (response.serverContent && response.serverContent.inputTranscription) {
                        const txt = response.serverContent.inputTranscription.text;
                        if (txt && txt.trim().length > 0) {
                            if (currentTranscript.length > 0) {
                                currentTranscript += " " + txt.trim();
                            } else {
                                currentTranscript = txt.trim();
                            }
                        }
                    }
                    
                    // Did the model respond meaning it is finished processing?
                    if (response.serverContent && response.serverContent.modelTurn) {
                        isModelDone = true;
                    }
                } catch (err) {}
            };

            websocket.onerror = () => {
                resolve(null);
            };

            // Wait for completion or timeout
            let elapsed = 0;
            const interval = setInterval(() => {
                elapsed += 100;
                // Wait for the model turn to finish, or force timeout after 20 seconds
                if (isModelDone || elapsed >= 20000) {
                    clearInterval(interval);
                    websocket.close();
                    resolve(currentTranscript ? currentTranscript.trim() : null);
                }
            }, 100);

        } catch (err) {
            console.error("WebSocket retry error:", err);
            resolve(null);
        }
    });
}

/**
 * Manually retry a transcription for a specific entry.
 */
export async function retryTranscription(entryId) {
    const entry = await getEntryById(entryId);
    if (!entry || entry.status !== 'failed_transcription') return false;

    const audioBlob = await getAudioFile(entryId);
    if (!audioBlob) {
        showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> Saved audio not found.');
        return false;
    }

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        showToast('<i class="fa-solid fa-key" style="color: #ef4444;"></i> API Key missing.');
        return false;
    }

    // Set to processing
    await updateEntry(entryId, { status: 'transcribing' });
    updateDateDisplay();

    const rawText = await retryAudioTranscriptionOverWebSocket(audioBlob, apiKey);
    
    if (rawText) {
        const dir = isRTL(rawText) ? 1 : 0;
        await updateEntry(entryId, {
            content: rawText,
            is_rtl: dir,
            status: 'enhancing'
        });
        updateDateDisplay();

        // Immediately try enhancing it
        const enhancedData = await enhanceTranscription(rawText, apiKey);
        if (enhancedData) {
            await updateEntry(entryId, {
                title: enhancedData.title,
                tags: enhancedData.tags,
                content: enhancedData.improvedText,
                is_rtl: isRTL(enhancedData.improvedText) ? 1 : 0,
                status: "completed"
            });
        } else {
            await updateEntry(entryId, {
                status: "failed_enhancement",
                title: "Failed Enhancement"
            });
        }
        updateDateDisplay();
        return true;
    } else {
        await updateEntry(entryId, { status: 'failed_transcription' });
        updateDateDisplay();
        return false;
    }
}

/**
 * Manually retry an enhancement for a specific entry.
 */
export async function retryEnhancement(entryId) {
    const entry = await getEntryById(entryId);
    if (!entry || entry.status !== 'failed_enhancement') return false;

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        showToast('<i class="fa-solid fa-key" style="color: #ef4444;"></i> API Key missing.');
        return false;
    }

    // Set to processing
    await updateEntry(entryId, { status: 'enhancing' });
    updateDateDisplay();

    const enhancedData = await enhanceTranscription(entry.content, apiKey);
    if (enhancedData) {
        await updateEntry(entryId, {
            title: enhancedData.title,
            tags: enhancedData.tags,
            content: enhancedData.improvedText,
            is_rtl: isRTL(enhancedData.improvedText) ? 1 : 0,
            status: "completed"
        });
        updateDateDisplay();
        return true;
    } else {
        await updateEntry(entryId, { status: 'failed_enhancement' });
        updateDateDisplay();
        return false;
    }
}

/**
 * Processes the queue of failed items sequentially.
 */
export async function processRetryQueue() {
    if (isQueueProcessing) return;
    
    // Check if user has disabled auto-retries
    if (localStorage.getItem('auto_retry_enabled') === 'false') {
        return;
    }
    
    isQueueProcessing = true;

    try {
        // Fetch all failed transcriptions
        const failedTranscriptions = await db.entries.where('status').equals('failed_transcription').toArray();
        for (const entry of failedTranscriptions) {
            console.log(`Auto-retrying transcription for ${entry.id}`);
            const success = await retryTranscription(entry.id);
            if (!success) break; // If one fails, stop auto-retrying to avoid spamming the API
        }

        // Fetch all failed enhancements
        const failedEnhancements = await db.entries.where('status').equals('failed_enhancement').toArray();
        for (const entry of failedEnhancements) {
            console.log(`Auto-retrying enhancement for ${entry.id}`);
            const success = await retryEnhancement(entry.id);
            if (!success) break; // Stop on failure
        }
    } catch (err) {
        console.error("Queue processor error:", err);
    } finally {
        isQueueProcessing = false;
    }
}
