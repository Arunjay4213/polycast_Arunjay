const express = require('express');
const router = express.Router();
const { pool } = require('../db'); // Assuming db/index.js exports pool
const OpenAI = require('openai');

// Check if audio exists for a card
router.get('/audio/:cardKey', async (req, res) => {
    const { cardKey } = req.params;
    console.log(`[Audio API] GET request for audio: ${cardKey}`);
    try {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT audio_data, content_type FROM audio_cache WHERE card_key = $1',
                [cardKey]
            );
            if (result.rowCount > 0) {
                const { audio_data, content_type } = result.rows[0];
                console.log(`[Audio API] Found cached audio for ${cardKey}, size: ${audio_data.length} bytes`);
                const base64Audio = audio_data.toString('base64');
                const audioUrl = `data:${content_type};base64,${base64Audio}`;
                res.json({ audioUrl });
            } else {
                console.log(`[Audio API] No cached audio found for ${cardKey}`);
                res.status(404).json({ error: 'Audio not found' });
            }
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(`[Audio API] Error retrieving audio for ${cardKey}:`, err);
        res.status(500).json({ error: 'Failed to retrieve audio' });
    }
});

// Generate and cache audio using OpenAI TTS
router.post('/generate-audio', async (req, res) => {
    const { text, cardKey, profile } = req.body; // profile might be used for voice selection later
    console.log(`[Audio API] POST request to generate audio for card: ${cardKey}, profile: ${profile}`);
    console.log(`[Audio API] Text to synthesize: "${text ? text.substring(0, 50) : 'undefined_text'}..."`);

    if (!text || !cardKey) {
        return res.status(400).json({ error: 'Missing text or cardKey' });
    }

    try {
        const client = await pool.connect();
        try {
            const existingResult = await client.query(
                'SELECT audio_data, content_type FROM audio_cache WHERE card_key = $1',
                [cardKey]
            );

            if (existingResult.rowCount > 0) {
                console.log(`[Audio API] Audio already exists for ${cardKey}, returning cached version`);
                const { audio_data, content_type } = existingResult.rows[0];
                const base64Audio = audio_data.toString('base64');
                const audioUrl = `data:${content_type};base64,${base64Audio}`;
                client.release(); // Release client before sending response
                return res.json({ audioUrl });
            }

            console.log(`[Audio API] Generating new audio for ${cardKey} using OpenAI TTS`);
            if (!process.env.OPENAI_API_KEY) {
                client.release(); // Release client before throwing error
                throw new Error('OpenAI API key not configured');
            }

            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const mp3Response = await openai.audio.speech.create({
                model: 'tts-1',
                voice: 'alloy', // Consider making voice configurable per profile/language
                input: text,
                response_format: 'mp3'
            });

            const audioBuffer = Buffer.from(await mp3Response.arrayBuffer());
            console.log(`[Audio API] Generated audio for ${cardKey}, size: ${audioBuffer.length} bytes`);

            await client.query(
                'INSERT INTO audio_cache (card_key, text_content, audio_data, content_type) VALUES ($1, $2, $3, $4)',
                [cardKey, text, audioBuffer, 'audio/mpeg']
            );
            console.log(`[Audio API] Cached audio for ${cardKey} in database`);

            const base64Audio = audioBuffer.toString('base64');
            const audioUrl = `data:audio/mpeg;base64,${base64Audio}`;
            res.json({ audioUrl });
        } finally {
            // Ensure client is released if it hasn't been already
            if (!client.ended) {
                 // Check if client is defined and not already released
                try {
                    client.release();
                } catch (e) {
                    // Ignore errors if release fails (e.g. already released)
                    console.warn("[Audio API] Client release failed in finally block, may have been already released:", e.message);
                }
            }
        }
    } catch (err) {
        console.error(`[Audio API] Error generating audio for ${cardKey}:`, err);
        res.status(500).json({ error: 'Failed to generate audio', message: err.message });
    }
});

module.exports = router;
