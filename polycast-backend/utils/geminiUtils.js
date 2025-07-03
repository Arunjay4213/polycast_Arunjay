const config = require('../config/config');

/**
 * A simple function to generate text using Gemini
 * Since llmService doesn't have a direct generateText function,
 * we'll implement our own here using the same initialization pattern
 * @param {string} prompt The prompt to send to Gemini
 * @param {number} temperature The temperature setting (0-1)
 * @returns {Promise<string>} The generated text response
 */
async function generateTextWithGemini(prompt, temperature = 0.7) {
    try {
        // Make sure we have the Google API key available (use same config as other services)
        if (!config.googleApiKey) {
            throw new Error('Google API Key (GOOGLE_API_KEY) is not configured');
        }

        // Log the prompt for debugging
        const promptPreview = prompt.length > 100 ? `${prompt.substring(0, 100)}...` : prompt;
        console.log(`[GEMINI] Generating text with prompt: ${promptPreview}`);

        // Use the raw Google API directly (same as other services)
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(config.googleApiKey);

        // Configure the model - using stable Gemini 2.0 Flash-Lite
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-lite",
            systemInstruction: "You're helping language learners understand words in context."
        });

        // Create a promise with timeout to ensure we don't hang indefinitely
        const timeoutMs = 15000; // 15 seconds timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs}ms`)), timeoutMs);
        });

        // Generate content with the provided temperature
        const generatePromise = model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: temperature,
                maxOutputTokens: 800,
                topP: 0.9,
                topK: 40
            }
        });

        // Race the generate promise against the timeout
        const result = await Promise.race([generatePromise, timeoutPromise]);

        // Process the result (only if not timed out)
        const response = result.response;
        if (!response) {
            throw new Error('Empty response received from Gemini API');
        }

        const text = response.text();
        if (!text || text.trim() === '') {
            throw new Error('Empty text received from Gemini API');
        }

        console.log(`[GEMINI] Successfully generated ${text.length} chars of text`);
        return text;
    } catch (error) {
        console.error('[GEMINI] Error generating text:', error.message);
        throw error; // Explicitly throw the error to propagate it up
    }
}

module.exports = {
    generateTextWithGemini
};
