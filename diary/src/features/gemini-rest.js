export async function enhanceTranscription(rawText, apiKey) {
    if (localStorage.getItem('disable_auto_enhance') === 'true') {
        const words = rawText.split(' ').slice(0, 5).join(' ');
        return {
            title: words + (rawText.length > words.length ? "..." : ""),
            tags: [],
            improvedText: rawText
        };
    }

    const disableTitle = localStorage.getItem('disable_title_generation') === 'true';
    const disableTags = localStorage.getItem('disable_tag_generation') === 'true';
    const customPrompt = localStorage.getItem('custom_enhance_prompt');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

    let instructionText = "Improve the grammar and clarity of the text while preserving the original meaning and language.";
    if (customPrompt && customPrompt.trim().length > 0) {
        instructionText = customPrompt.trim();
    }

    const tasks = [`1. ${instructionText}`];
    if (!disableTitle) tasks.push("2. Generate a short, catchy title for this diary entry.");
    if (!disableTags) tasks.push("3. Generate 1 to 3 relevant tags for this entry.");

    const prompt = `
You are a helpful diary assistant. Your task is to process the following raw transcription from the user.
${tasks.join('\n')}

Raw Transcription:
"${rawText}"

CRITICAL INSTRUCTION: You must respond ONLY with a raw, valid JSON object. Do NOT include any reasoning, chain of thought, or markdown formatting (no \`\`\`json). Output exactly the requested structure and nothing else.
`;

    const schemaProperties = {
        improved_text: { type: "STRING", description: "The processed transcription according to the instructions." }
    };
    const schemaRequired = ["improved_text"];

    if (!disableTitle) {
        schemaProperties.title = { type: "STRING", description: "A short, catchy title for the entry." };
        schemaRequired.push("title");
    }
    
    if (!disableTags) {
        schemaProperties.tags = { type: "ARRAY", items: { type: "STRING" }, description: "1 to 3 relevant tags." };
        schemaRequired.push("tags");
    }

    const requestBody = {
        contents: [
            {
                role: "user",
                parts: [{ text: prompt }]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: schemaProperties,
                required: schemaRequired
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        // Extract the JSON response from the model
        if (data && data.candidates && data.candidates.length > 0) {
            let jsonString = data.candidates[0].content.parts[0].text;
            
            // Clean up the string in case the model ignored instructions and included markdown/reasoning
            // Find the first { and last } to extract the JSON object
            const startIndex = jsonString.indexOf('{');
            const endIndex = jsonString.lastIndexOf('}');
            
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                jsonString = jsonString.substring(startIndex, endIndex + 1);
            }

            try {
                const result = JSON.parse(jsonString);
                
                // Fallback title generation if disabled
                let finalTitle = result.title;
                if (!finalTitle || disableTitle) {
                    const words = result.improved_text ? result.improved_text.split(' ').slice(0, 5).join(' ') : rawText.split(' ').slice(0, 5).join(' ');
                    finalTitle = words + "...";
                }

                return {
                    title: finalTitle,
                    tags: result.tags || [],
                    improvedText: result.improved_text || rawText
                };
            } catch (parseErr) {
                console.error("Failed to parse Gemma JSON output:", parseErr, jsonString);
                return null;
            }
        }
        return null;
    } catch (error) {
        console.error("Error enhancing transcription:", error);
        return null;
    }
}

export async function editTranscriptionWithGemma(originalText, originalTitle, originalTags, voiceInstruction, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

    const prompt = `
You are an intelligent diary editor. Apply the user's voice instruction to the existing diary entry below.

Original Entry:
- Title: "${originalTitle}"
- Tags: ${JSON.stringify(originalTags)}
- Text: "${originalText}"

Voice Instruction:
"${voiceInstruction}"

Task:
1. Update the "Text" exactly as instructed. Keep unaffected parts identical.
2. Update the "Title" or "Tags" only if specifically requested. Otherwise, return the originals.

CRITICAL INSTRUCTION: You must respond ONLY with a raw, valid JSON object. Do NOT include any reasoning, chain of thought, or markdown formatting (no \`\`\`json). Output exactly the requested structure and nothing else.
`;

    const requestBody = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING", description: "The modified title (or the original if no change was requested)." },
                    tags: { type: "ARRAY", items: { type: "STRING" }, description: "The modified tags (or the original if no change was requested)." },
                    improved_text: { type: "STRING", description: "The modified transcription text with the user's edits applied." }
                },
                required: ["title", "tags", "improved_text"]
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        if (data && data.candidates && data.candidates.length > 0) {
            let jsonString = data.candidates[0].content.parts[0].text;
            const startIndex = jsonString.indexOf('{');
            const endIndex = jsonString.lastIndexOf('}');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                jsonString = jsonString.substring(startIndex, endIndex + 1);
            }

            try {
                const result = JSON.parse(jsonString);
                return {
                    title: result.title || originalTitle,
                    tags: result.tags || originalTags,
                    improvedText: result.improved_text || originalText
                };
            } catch (parseErr) {
                console.error("Failed to parse Gemma edit output:", parseErr, jsonString);
                return null;
            }
        }
        return null;
    } catch (error) {
        console.error("Error editing transcription:", error);
        return null;
    }
}

export async function expandSearchQuery(query, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

    const prompt = `
You are an intelligent search assistant. The user wants to search their personal diary for the phrase: "${query}"
Generate 3 to 5 highly relevant synonymous or related search terms that could also match the user's intent.
Keep the terms short and concise. Do NOT include the original query in the output.

CRITICAL INSTRUCTION: You must respond ONLY with a raw, valid JSON object. Do NOT include any reasoning, chain of thought, or markdown formatting.
`;

    const requestBody = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    terms: { 
                        type: "ARRAY", 
                        items: { type: "STRING" },
                        description: "List of synonymous or related search terms." 
                    }
                },
                required: ["terms"]
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data && data.candidates && data.candidates.length > 0) {
            let jsonString = data.candidates[0].content.parts[0].text;
            const startIndex = jsonString.indexOf('{');
            const endIndex = jsonString.lastIndexOf('}');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                jsonString = jsonString.substring(startIndex, endIndex + 1);
            }

            try {
                const result = JSON.parse(jsonString);
                return result.terms || [];
            } catch (parseErr) {
                console.error("Failed to parse Gemma search expansion:", parseErr);
                return [];
            }
        }
        return [];
    } catch (error) {
        console.error("Error expanding search query:", error);
        return [];
    }
}

export async function filterEntriesForAINote(noteTitle, noteDesc, entriesArray, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

    const entriesText = entriesArray.map(e => `[ID: ${e.id}] Title: ${e.title}\nContent: ${e.content}`).join('\n\n');

    const prompt = `
You are an AI router that categorizes diary entries into folders.
You have a folder named "${noteTitle}".
Folder Description: "${noteDesc}"

Here are several new diary entries:
${entriesText}

Analyze each entry. Determine if it belongs in the "${noteTitle}" folder based on the folder's description.
Return a JSON array containing ONLY the IDs of the entries that belong in this folder.

CRITICAL INSTRUCTION: You must respond ONLY with a raw, valid JSON object. Do NOT include any reasoning, markdown formatting, or explanations.
`;

    const requestBody = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    matched_ids: { 
                        type: "ARRAY", 
                        items: { type: "STRING" },
                        description: "List of entry IDs that belong in the folder." 
                    }
                },
                required: ["matched_ids"]
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data && data.candidates && data.candidates.length > 0) {
            let jsonString = data.candidates[0].content.parts[0].text;
            const startIndex = jsonString.indexOf('{');
            const endIndex = jsonString.lastIndexOf('}');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                jsonString = jsonString.substring(startIndex, endIndex + 1);
            }

            try {
                const result = JSON.parse(jsonString);
                return result.matched_ids || [];
            } catch (parseErr) {
                console.error("Failed to parse Gemma AI Notes matching:", parseErr);
                return [];
            }
        }
        return [];
    } catch (error) {
        console.error("Error filtering entries for AI note:", error);
        return [];
    }
}

/**
 * Generic text generation utilizing Gemini 3 Flash Preview (or fallback to Gemma).
 * Used heavily by the Summarization Engine.
 */
export async function generateGeminiContent(prompt, apiKeyOverride = null) {
    const apiKey = apiKeyOverride || localStorage.getItem('gemini_api_key');
    if (!apiKey) throw new Error("Missing API Key");

    // Can use Gemini 3.1 Flash Preview as instructed in previous contexts, or stick to the Gemma model.
    // We will use the exact model string researched by the subagent:
    const model = 'gemini-3-flash-preview'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (data && data.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
    }
    
    throw new Error("No valid response generated from Gemini");
}

export async function transcribeAudioFile(blob, mimeType, apiKey) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
            try {
                const base64Data = reader.result.split(',')[1];
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;
                
                const requestBody = {
                    contents: [{
                        role: "user",
                        parts: [
                            { text: "Accurately transcribe the spoken words in this audio exactly as they are without omitting or summarizing." },
                            { inlineData: { mimeType: mimeType, data: base64Data } }
                        ]
                    }]
                };

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API Error: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                if (data && data.candidates && data.candidates.length > 0) {
                    resolve(data.candidates[0].content.parts[0].text);
                } else {
                    reject(new Error("No transcription received"));
                }
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}


