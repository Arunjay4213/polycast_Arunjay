const express = require('express');
const router = express.Router();
const { pool } = require('../db'); // Assuming db/index.js exports pool
const { getDefaultLanguageForProfile } = require('../utils/profileUtils');
const { generateTextWithGemini } = require('../utils/geminiUtils');

// Add word to specific profile endpoint
router.post('/profile/:profile/add-word', async (req, res) => {
    const { profile } = req.params;
    const { word } = req.body;

    if (!word || typeof word !== 'string') {
        return res.status(400).json({ error: 'Word is required' });
    }

    const normalizedWord = word.trim().toLowerCase();
    console.log(`[Add Word API] Adding word "${normalizedWord}" to profile: ${profile}`);

    const client = await pool.connect();
    try {
        const existingCheck = await client.query(
            'SELECT word_sense_id FROM flashcards WHERE profile_name = $1 AND LOWER(word) = $2 LIMIT 1',
            [profile, normalizedWord]
        );

        if (existingCheck.rowCount > 0) {
            console.log(`[Add Word API] Word "${normalizedWord}" already exists for profile ${profile}`);
            return res.status(409).json({
                error: 'duplicate',
                message: `"${word}" is already in your dictionary!`,
                wordSenseId: existingCheck.rows[0].word_sense_id
            });
        }

        const targetLanguage = getDefaultLanguageForProfile(profile);
        console.log(`[Add Word API] Fetching definition for "${normalizedWord}" in ${targetLanguage}`);

        const prompt = `You are an expert language teacher helping a student understand a word.

The word "${normalizedWord}" needs a definition and translation.

Output ONLY a JSON object with these fields:
{
  "translation": "${targetLanguage} translation of the word",
  "partOfSpeech": "The part of speech (noun, verb, adjective, etc.)",
  "definition": "A clear and concise definition",
  "example": "A simple example sentence",
  "definitionNumber": 1,
  "contextualExplanation": "A short phrase IN ${targetLanguage} explaining what '${normalizedWord}' means."
}

Do NOT provide multiple definitions or explanations outside the JSON.`;

        const llmResponse = await generateTextWithGemini(prompt, 0.2);
        const jsonMatch = llmResponse.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) {
            throw new Error('Could not extract JSON from LLM response for add-word');
        }

        const parsedResponse = JSON.parse(jsonMatch[0]);
        const wordSenseId = `${normalizedWord}_${parsedResponse.definitionNumber || 1}`;

        const flashcardPrompt = `Create flashcard sentences for the word "${normalizedWord}" (meaning: ${parsedResponse.definition}).

You must provide EXACTLY 12 parts separated by " // ":
- Parts 1-10: Five pairs of sentences (English sentence // ${targetLanguage} translation)
- Part 11: Word frequency number (1-10)
- Part 12: Definition frequency number (1-10)

CRITICAL REQUIREMENTS:
1. The word "${normalizedWord}" must be wrapped in ~tildes~ in EVERY sentence
2. Create natural, varied sentences showing different uses of the word
3. Provide exactly 12 parts - no more, no less
4. No extra text, explanations, or formatting

Example format:
I love ~pizza~ for dinner // 我爱晚餐吃~披萨~ // The ~pizza~ was delicious // ~披萨~很好吃 // We ordered ~pizza~ yesterday // 我们昨天点了~披萨~ // Hot ~pizza~ tastes great // 热~披萨~很好吃 // Fresh ~pizza~ is the best // 新鲜的~披萨~最好 // 8 // 9

Now create exactly this format for "${normalizedWord}":`;

        const flashcardContent = await generateTextWithGemini(flashcardPrompt, 0.2);
        let cleanedContent = flashcardContent;
        const preamblePatterns = [/^Here's the output:\s*/i, /^Here are the\s+.*?:\s*/i, /^The output is:\s*/i, /^Output:\s*/i, /^Here's.*?:\s*/i];
        for (const pattern of preamblePatterns) {
            cleanedContent = cleanedContent.replace(pattern, '');
        }

        const contentParts = cleanedContent.split('//').map(part => part.trim());
        let exampleSentencesRaw = '';
        let wordFrequency = 3;
        let definitionFrequency = 3;

        if (contentParts.length >= 12) {
            const sentences = contentParts.slice(0, 10);
            exampleSentencesRaw = sentences.join('//');
            wordFrequency = parseInt(contentParts[10]) || 3;
            definitionFrequency = parseInt(contentParts[11]) || 3;
        } else {
            console.error(`[Add Word API] Gemini response parsing failed for "${normalizedWord}":`, {
                rawResponse: flashcardContent, cleanedResponse, parts: contentParts, expectedParts: 12, actualParts: contentParts.length
            });
            throw new Error(`Failed to generate proper example sentences for word "${normalizedWord}". Expected 12 parts but got ${contentParts.length}. Fix the Gemini prompt.`);
        }

        if (!exampleSentencesRaw.includes(`~${normalizedWord}~`)) {
            console.error(`[Add Word API] Generated sentences missing ~word~ markup for "${normalizedWord}":`, exampleSentencesRaw);
            throw new Error(`Generated examples for "${normalizedWord}" missing proper ~word~ markup. Fix the Gemini prompt.`);
        }

        await client.query('BEGIN');
        await client.query(`
            INSERT INTO flashcards (profile_name, word_sense_id, word, definition, translation, part_of_speech, definition_number, example, in_flashcards)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            profile, wordSenseId, normalizedWord, parsedResponse.definition, parsedResponse.translation,
            parsedResponse.partOfSpeech, parsedResponse.definitionNumber || 1, parsedResponse.example, true
        ]);
        await client.query(`
            UPDATE profiles SET selected_words = array_append(COALESCE(selected_words, ARRAY[]::text[]), $2), last_updated = $3
            WHERE profile_name = $1
        `, [profile, normalizedWord, new Date()]);
        await client.query('COMMIT');

        console.log(`[Add Word API] Successfully added "${normalizedWord}" to profile ${profile}`);
        const responseData = {
            wordSenseId, word: normalizedWord, translation: parsedResponse.translation, partOfSpeech: parsedResponse.partOfSpeech,
            definition: parsedResponse.definition, definitions: [{ text: parsedResponse.definition, example: parsedResponse.example }],
            example: parsedResponse.example, definitionNumber: parsedResponse.definitionNumber || 1,
            contextualExplanation: parsedResponse.contextualExplanation, exampleSentencesRaw,
            exampleSentencesGenerated: exampleSentencesRaw, wordFrequency, definitionFrequency,
            inFlashcards: true, isContextual: true // Assuming new words added this way are contextual
        };
        res.status(201).json(responseData);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[Add Word API] Error adding word "${normalizedWord}":`, error);
        res.status(500).json({ error: 'Failed to add word', details: error.message });
    } finally {
        client.release();
    }
});


// GET endpoint to retrieve flashcards and highlighted words for a specific profile
router.get('/profile/:profile/words', async (req, res) => {
    const profile = req.params.profile;
    console.log(`[Profile API] GET request for profile: ${profile}`);

    try {
        const client = await pool.connect();
        console.log(`[Profile API] Database connection successful for GET request`);
        try {
            console.log(`[Profile API] Checking if profile '${profile}' exists`);
            const profileCheck = await client.query('SELECT * FROM profiles WHERE profile_name = $1', [profile]);
            if (profileCheck.rowCount === 0) {
                console.log(`[Profile API] Profile '${profile}' doesn't exist, creating it`);
                await client.query('INSERT INTO profiles (profile_name, selected_words) VALUES ($1, $2) RETURNING *', [profile, []]);
            }

            const profileResult = await client.query('SELECT selected_words FROM profiles WHERE profile_name = $1', [profile]);
            const selectedWords = profileResult.rows[0]?.selected_words || [];

            const flashcardsResult = await client.query('SELECT * FROM flashcards WHERE profile_name = $1', [profile]);
            console.log(`[Profile API] Retrieved ${flashcardsResult.rowCount} flashcards from database for profile ${profile}`);

            const flashcards = {};
            for (const card of flashcardsResult.rows) {
                if (!card || !card.word_sense_id || !card.word) {
                    console.log(`[Profile API] WARNING: Skipping invalid card data:`, card);
                    continue;
                }
                const definitionNumber = card.definition_number || 1;
                const properWordSenseId = `${card.word.toLowerCase()}_${definitionNumber}`;

                flashcards[properWordSenseId] = {
                    word: card.word,
                    wordSenseId: properWordSenseId,
                    definition: card.definition || '',
                    translation: card.translation || '',
                    partOfSpeech: card.part_of_speech || 'unknown',
                    contextSentence: card.context || '',
                    context: card.context || '',
                    definitionNumber: definitionNumber,
                    example: card.example || '',
                    exampleSentencesRaw: card.example || '',
                    inFlashcards: card.in_flashcards !== null ? card.in_flashcards : true // Default to true if null
                };
            }

            const profileData = { flashcards, selectedWords };
            console.log(`[Profile API] Returning ${Object.keys(profileData.flashcards).length} flashcards and ${profileData.selectedWords.length} selected words for profile: ${profile}`);
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(profileData); // Use .json directly
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(`[Profile API] Error retrieving data for profile ${profile}:`, err);
        res.status(500).json({ error: 'Failed to retrieve profile data' });
    }
});

// POST endpoint to save flashcards and highlighted words for a specific profile
router.post('/profile/:profile/words', async (req, res) => {
    const { profile } = req.params;
    const { flashcards, selectedWords } = req.body;
    console.log(`[Profile API] POST request for profile: ${profile}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'INSERT INTO profiles (profile_name, selected_words, last_updated) VALUES ($1, $2, $3) ON CONFLICT (profile_name) DO UPDATE SET selected_words = $2, last_updated = $3',
            [profile, selectedWords || [], new Date()]
        );

        const existingFlashcardsResult = await client.query('SELECT word_sense_id FROM flashcards WHERE profile_name = $1', [profile]);
        const existingFlashcardIds = existingFlashcardsResult.rows.map(row => row.word_sense_id);

        const requestFlashcardIds = Object.keys(flashcards || {});
        const flashcardsToDelete = existingFlashcardIds.filter(id => !requestFlashcardIds.includes(id));

        if (flashcardsToDelete.length > 0) {
            await client.query('DELETE FROM flashcards WHERE profile_name = $1 AND word_sense_id = ANY($2::varchar[])', [profile, flashcardsToDelete]);
            console.log(`[Profile API] Deleted ${flashcardsToDelete.length} flashcards.`);
        }

        for (const wordSenseId of requestFlashcardIds) {
            const card = flashcards[wordSenseId];
            if (!card) {
                console.warn(`[Profile API] Skipping null/undefined card for wordSenseId: ${wordSenseId}`);
                continue;
            }

            const wordValue = card.word || wordSenseId.replace(/_\d+$/, ''); // Extract word from ID if not present
            let definitionNumber = card.definitionNumber;
            if (definitionNumber === null || definitionNumber === undefined) {
                const numMatch = wordSenseId.match(/_(\d+)$/);
                definitionNumber = numMatch ? parseInt(numMatch[1]) : 1;
            }

            await client.query(`
                INSERT INTO flashcards (
                    profile_name, word_sense_id, word, definition, translation,
                    part_of_speech, context, definition_number, example, in_flashcards
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (profile_name, word_sense_id) DO UPDATE SET
                    word = EXCLUDED.word,
                    definition = EXCLUDED.definition,
                    translation = EXCLUDED.translation,
                    part_of_speech = EXCLUDED.part_of_speech,
                    context = EXCLUDED.context,
                    definition_number = EXCLUDED.definition_number,
                    example = EXCLUDED.example,
                    in_flashcards = EXCLUDED.in_flashcards
            `, [
                profile, wordSenseId, wordValue, card.definition || '', card.translation || '',
                card.partOfSpeech || 'unknown', card.contextSentence || card.context || '',
                definitionNumber, card.example || card.exampleSentencesRaw || '',
                card.inFlashcards === false ? false : true
            ]);
        }

        await client.query('COMMIT');
        console.log(`[Profile API] Successfully stored data for profile: ${profile}`);
        res.json({ success: true, message: `Data for profile '${profile}' saved successfully`, timestamp: new Date().toISOString() });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Profile API] ERROR storing data for profile ${profile}:`, err);
        res.status(500).json({ success: false, message: `Failed to save data for profile '${profile}'`, error: err.message });
    } finally {
        client.release();
    }
});

// GET /api/profile/:profile/srs-daily - Get daily SRS data for a profile
router.get('/profile/:profile/srs-daily', async (req, res) => {
    const { profile } = req.params;
    const today = new Date().toISOString().split('T')[0];
    console.log(`[SRS Daily API] GET request for profile: ${profile}, date: ${today}`);
    try {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT date, new_cards_today FROM srs_daily WHERE profile_name = $1 AND date = $2',
                [profile, today]
            );
            if (result.rowCount > 0) {
                res.json({ date: result.rows[0].date, newCardsToday: result.rows[0].new_cards_today });
            } else {
                res.json({ date: today, newCardsToday: 0 });
            }
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(`[SRS Daily API] Error getting daily data for ${profile}:`, err);
        res.status(500).json({ error: 'Failed to get daily SRS data', message: err.message });
    }
});

// POST /api/profile/:profile/srs-daily - Save daily SRS data for a profile
router.post('/profile/:profile/srs-daily', async (req, res) => {
    const { profile } = req.params;
    const { date, newCardsToday } = req.body;
    console.log(`[SRS Daily API] POST request for profile: ${profile}, date: ${date}, newCardsToday: ${newCardsToday}`);
    try {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO srs_daily (profile_name, date, new_cards_today)
                VALUES ($1, $2, $3)
                ON CONFLICT (profile_name, date)
                DO UPDATE SET new_cards_today = EXCLUDED.new_cards_today
            `, [profile, date, newCardsToday]);
            res.json({ success: true, message: `Daily SRS data saved for profile '${profile}'` });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(`[SRS Daily API] Error saving daily data for ${profile}:`, err);
        res.status(500).json({ error: 'Failed to save daily SRS data', message: err.message });
    }
});


module.exports = router;
