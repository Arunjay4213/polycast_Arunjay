const express = require('express');
const router = express.Router();
const { generateImage } = require('../services/imageService');

// === IMAGE GENERATION ENDPOINT ===
router.get('/generate-image', async (req, res) => {
    const prompt = req.query.prompt || '';
    const size = req.query.size || '1024x1024';
    const moderation = req.query.moderation || 'auto'; // Or 'skip'

    console.log(`[Image Generation] Request received. Prompt: "${prompt.substring(0, 30)}...", Size: ${size}, Moderation: ${moderation}`);

    try {
        const imgPayload = await generateImage(prompt, size, moderation);
        console.log('[Image Generation] Success! Image payload ready');
        res.json({ url: imgPayload }); // imgPayload is the data URI or URL
    } catch (error) {
        console.error('[Image Generation] Error:', error.message, error.stack);
        res.status(500).json({ error: 'Failed to generate image.' });
    }
});

module.exports = router;
