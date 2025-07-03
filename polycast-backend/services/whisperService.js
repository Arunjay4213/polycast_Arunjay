const axios = require('axios');
const FormData = require('form-data');
const config = require('../config/config');

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Transcribes audio data using the OpenAI Whisper API.
 * @param {Buffer} audioBuffer The audio data as a Buffer.
 * @param {string} [filename='audio.wav'] The filename to use for the FormData.
 *                                          Needs a valid extension for Whisper.
 * @returns {Promise<string>} The transcribed text.
 * @throws {Error} If the API call fails or returns an error.
 */
async function transcribeAudio(audioBuffer, filename = 'audio.wav') {
    if (!config.openaiApiKey) {
        throw new Error('OpenAI API key is not configured.');
    }
    if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('Audio buffer is empty or invalid.');
    }

    // Directly send the received buffer as wav to Whisper
    const form = new FormData();
    form.append('file', audioBuffer, {
        filename: filename, // Whisper needs a filename with a valid extension
        contentType: 'audio/wav',
    });
    form.append('model', 'whisper-1');
    form.append('language', 'en'); // Prime for English speech detection

    console.log(`Sending ${audioBuffer.length} bytes to Whisper API...`);

    try {
        const response = await axios.post(WHISPER_API_URL, form, {
            headers: {
                'Authorization': `Bearer ${config.openaiApiKey}`,
                ...form.getHeaders(), // Important for multipart/form-data
            },
            maxBodyLength: Infinity, // Allow large file uploads
        });

        console.log('Whisper API response status:', response.status);

        if (response.data && response.data.text) {
            console.log('Transcription received:', response.data.text);
            return response.data.text;
        } else {
            // This case might indicate an unexpected response format
            console.error('Unexpected response format from Whisper API:', response.data);
            throw new Error('Unexpected response format from Whisper API.');
        }
    } catch (error) {
        console.error('Error calling Whisper API:', error.response ? error.response.data : error.message);
        // Re-throw a more specific error message if available
        const errorMessage = error.response?.data?.error?.message || error.message || 'Failed to transcribe audio.';
        throw new Error(`Whisper API Error: ${errorMessage}`);
    }
}

module.exports = {
    transcribeAudio,
};
