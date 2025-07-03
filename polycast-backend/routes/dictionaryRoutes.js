const express = require('express');
const router = express.Router();
const { generateTextWithGemini } = require('../utils/geminiUtils'); // Correct path

// Mock dictionary response for testing or development
function mockDictionaryResponse(word) {
    return {
        translation: `Translation of ${word}`,
        partOfSpeech: 'noun',
        frequencyRating: 3,
        definitions: [{
            text: `Mock definition for ${word}`,
            example: `This is a mock example for ${word}.`
        }],
        isContextual: true,
        contextualExplanation: `Mock contextual explanation for ${word} in target language.`
    };
}

// Dictionary API route - provides a contextual definition for a word
router.get('/dictionary/:word', async (req, res) => {
    try {
        const { word } = req.params;
        const context = req.query.context || '';
        const targetLanguage = req.query.targetLanguage || 'Spanish';
        console.log(`[Dictionary API] Getting definition for: ${word}${context ? ' with context: "' + context + '"' : ''} in ${targetLanguage}`);

        const prompt = `You are an expert language teacher helping a student understand a word in its specific context.

The word "${word}" appears in this context: "${context}"

Your task is to:
1. Identify the SINGLE best definition that applies to how this word is used in this specific context
2. Provide a definition number that represents this specific meaning (you can use any appropriate number)

Output ONLY a JSON object with these fields:
{
  "translation": "${targetLanguage} translation of the word as used in this specific context",
  "partOfSpeech": "The part of speech of the word in this context (noun, verb, adjective, etc.)",
  "definition": "A clear and concise definition appropriate for how the word is used in this context only",
  "example": "A simple example sentence showing a similar usage to the context",
  "definitionNumber": "A number representing this specific meaning (e.g., 1, 2, 3, etc.)",
  "contextualExplanation": "A short phrase IN ${targetLanguage} (10 words max) explaining what '${word}' means here."
}

Do NOT provide multiple definitions or explanations outside the JSON.`;

        console.log('[Dictionary API] Prompt:', prompt.substring(0, 200) + '...');
        const llmResponse = await generateTextWithGemini(prompt, 0.2);

        try {
            const jsonMatch = llmResponse.match(/\{[\s\S]*?\}/);
            if (!jsonMatch) {
                throw new Error('Could not extract JSON from LLM response');
            }
            const jsonStr = jsonMatch[0];
            const parsedResponse = JSON.parse(jsonStr);

            const wordSenseId = `${word.toLowerCase()}_${parsedResponse.definitionNumber || 1}`;

            const formattedResponse = {
                wordSenseId: wordSenseId,
                word: word,
                translation: parsedResponse.translation || '',
                partOfSpeech: parsedResponse.partOfSpeech || '',
                definition: parsedResponse.definition || '',
                definitions: [{
                    text: parsedResponse.definition || '',
                    example: parsedResponse.example || ''
                }],
                definitionNumber: parsedResponse.definitionNumber || 1,
                contextualExplanation: parsedResponse.contextualExplanation || '',
                isContextual: true
            };

            console.log(`[Dictionary API] Found definition number ${formattedResponse.definitionNumber} for "${word}" in context: "${context.substring(0, 30)}..."`);

            let flashcardContent = '';
            try {
                const flashcardPrompt = `Generate 5 pairs of example sentences for the word '${word}' (definition: ${parsedResponse.definition}). Each pair should have:
1. English sentence with the target word wrapped in ~tildes~
2. Translation in the target language with the target word wrapped in ~tildes~

Format each pair as: English sentence // Translation sentence

CRITICAL: The target word '${word}' MUST be wrapped in ~tildes~ in both English and translation.

Example format:
I will ~charge~ into battle // 我将~冲锋~进入战斗 // The phone needs to ~charge~ // 手机需要~充电~ // etc.

After the 5 sentence pairs, provide two frequency ratings (1-10 scale):
- Word frequency: How common '${word}' is in general vocabulary (1=extremely rare, 10=ubiquitous)
- Definition frequency: How common this specific meaning is for this word (1=very rare meaning, 10=primary meaning)

Frequency guidelines: Most words are 1-3, very few are 9-10. Examples: "apple"=8, "deciduous"=3, "syzygy"=1

Your output format: [English ~word~] // [Translation ~word~] // [English ~word~] // [Translation ~word~] // [English ~word~] // [Translation ~word~] // [English ~word~] // [Translation ~word~] // [English ~word~] // [Translation ~word~] // [word_freq] // [def_freq]`;

                flashcardContent = await generateTextWithGemini(flashcardPrompt, 0.2);
                console.log(`[Dictionary API] Flashcard content for "${word}": ${flashcardContent}`);

                const contentParts = flashcardContent.split('//').map(part => part.trim());

                if (contentParts.length >= 12) {
                    const sentences = contentParts.slice(0, 10);
                    const wordFrequency = contentParts[10];
                    const definitionFrequency = contentParts[11];

                    formattedResponse.exampleSentencesRaw = sentences.join('//');
                    formattedResponse.exampleSentencesGenerated = sentences.join('//');
                    formattedResponse.exampleSentences = sentences;
                    formattedResponse.wordFrequency = parseInt(wordFrequency) || 3;
                    formattedResponse.definitionFrequency = parseInt(definitionFrequency) || 3;

                    console.log(`[Dictionary API] Generated ${sentences.length} sentences. Word frequency: ${formattedResponse.wordFrequency}, Definition frequency: ${formattedResponse.definitionFrequency}`);
                } else if (contentParts.length >= 5) {
                    const [sentence1, sentence2, sentence3, wordFrequency, definitionFrequency] = contentParts;
                    formattedResponse.exampleSentences = [sentence1, sentence2, sentence3];
                    formattedResponse.exampleSentencesRaw = `${sentence1}//${sentence2}//${sentence3}`;
                    formattedResponse.exampleSentencesGenerated = `${sentence1}//${sentence2}//${sentence3}`;
                    formattedResponse.wordFrequency = parseInt(wordFrequency) || 3;
                    formattedResponse.definitionFrequency = parseInt(definitionFrequency) || 3;
                    console.log(`[Dictionary API] Using old format fallback. Word frequency: ${formattedResponse.wordFrequency}, Definition frequency: ${formattedResponse.definitionFrequency}`);
                } else {
                    console.error('[Dictionary API] Unexpected flashcard content format:', flashcardContent);
                    formattedResponse.exampleSentencesRaw = flashcardContent; // Keep raw content if parsing fails
                    formattedResponse.wordFrequency = 3;
                    formattedResponse.definitionFrequency = 3;
                }
            } catch (exErr) {
                console.error('[Dictionary API] Error generating flashcard content:', exErr);
                formattedResponse.exampleSentencesRaw = '';
                formattedResponse.wordFrequency = 3;
                formattedResponse.definitionFrequency = 3;
            }

            console.log(`[Dictionary API] Final response for "${word}":`, JSON.stringify(formattedResponse, null, 2));
            res.json(formattedResponse);
        } catch (parseError) {
            console.error('[Dictionary API] Error parsing response:', parseError);
            res.status(500).json({ error: 'Failed to parse definition', raw: llmResponse });
        }
    } catch (error) {
        console.error("Dictionary API error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get definition from local JSON dictionary files (Now uses LLM)
router.get('/local-dictionary/:letter/:word', async (req, res) => {
    const { letter, word } = req.params;
    const contextSentence = req.query.context || '';
    const targetLanguage = req.query.targetLanguage || 'Spanish';

    if (!/^[a-z]$/.test(letter)) {
        return res.status(400).json({ error: 'Letter parameter must be a single letter a-z' });
    }

    try {
        const prompt = `You are creating dictionary entries for non-native English speakers who are learning English.

Your job is to explain the English word "${word}" in a simple, clear way that helps beginners understand it.
The word appears in this context: "${contextSentence}". Your definition and example should be specific to how the word is used in this context ONLY.
Your response must be in JSON format with these fields:
{
  "translation": "${targetLanguage} translation of the word as used in this specific context",
  "partOfSpeech": "The part of speech (noun, verb, adjective, etc.) of the word in this context",
  "frequencyRating": "A number from 1 to 5 representing how common this word is in everyday English in this sense",
  "definition": "VERY SIMPLE and SHORT explanation in simple English for how the word is used in this context (1-2 short sentences max)",
  "example": "A simple example sentence in English that uses this word in a similar way to the context.",
  "contextualExplanation": "A short phrase IN ${targetLanguage} (10 words max) explaining what '${word}' means here."
}

IMPORTANT: ONLY provide the definition of the word as it is used in the context sentence. DO NOT provide multiple definitions or alternative meanings.
Only return the JSON object, nothing else.`;

        console.log('--- LLM Definition Prompt (local-dictionary) ---');
        console.log(prompt.substring(0, 200) + '...');
        // console.log(prompt); // Full prompt if needed for debugging
        console.log('--- End LLM Definition Prompt ---');

        if (process.env.NODE_ENV === 'test' || process.env.MOCK_LLM === 'true') {
            console.log('Using mock LLM data for local-dictionary');
            return res.json(mockDictionaryResponse(word)); // Use the same mock for consistency
        }

        const llmResponse = await generateTextWithGemini(prompt, 0.3);

        try {
            const jsonMatch = llmResponse.match(/\{[\s\S]*?\}/);
            if (!jsonMatch) {
                throw new Error('Could not extract JSON from LLM response');
            }
            const jsonStr = jsonMatch[0];
            console.log(`Extracted JSON response for ${word} (local-dictionary):`, jsonStr);
            const parsedResponse = JSON.parse(jsonStr);

            const normalizedResponse = {
                translation: parsedResponse.translation || '',
                partOfSpeech: parsedResponse.partOfSpeech || '',
                frequencyRating: parsedResponse.frequencyRating || 3,
                contextualExplanation: parsedResponse.contextualExplanation || '',
                definitions: [{
                    text: parsedResponse.definition || '',
                    example: parsedResponse.example || ''
                }],
                isContextual: true // Mark as contextual since it uses contextSentence
            };

            res.json(normalizedResponse);
        } catch (parseError) {
            console.error(`Error parsing LLM response for ${word} (local-dictionary):`, parseError);
            res.status(500).json({ error: 'Failed to parse LLM response', raw: llmResponse });
        }
    } catch (error) {
        console.error(`Error getting definition for ${word} (local-dictionary):`, error);
        res.status(500).json({ error: 'Failed to get definition', message: error.message });
    }
});

// New endpoint for generating example sentences in the background
router.post('/dictionary/generate-examples', async (req, res) => {
    try {
        const { word, definition, prompt } = req.body;

        if (!word || typeof word !== 'string' || !definition || typeof definition !== 'string' || !prompt || typeof prompt !== 'string') {
            return res.status(400).json({
                error: 'Missing or invalid word, definition, or prompt parameter',
                status: 'error'
            });
        }

        console.log(`[EXAMPLE GENERATION] Generating examples for word: ${word}`);
        console.log(`[EXAMPLE GENERATION] Definition: ${definition.substring(0, 50)}...`);

        let response;
        try {
            response = await generateTextWithGemini(prompt, 0.7);
            if (!response || response.trim() === '') {
                throw new Error('Empty response from Gemini API');
            }
            console.log(`[EXAMPLE GENERATION] Generated examples: ${response.substring(0, 100)}...`);
        } catch (geminiError) {
            console.error(`[EXAMPLE GENERATION] Gemini API error for word '${word}':`, geminiError);
            return res.status(502).json({
                error: `Gemini API error: ${geminiError.message}`,
                status: 'error',
                message: 'There was an issue generating examples. Please try again later.',
                word: word
            });
        }

        const cleanedResponse = String(response).trim();
        console.log(`[EXAMPLE GENERATION] Sending raw text response:`, cleanedResponse.substring(0, 200) + '...');
        res.setHeader('Content-Type', 'text/plain');
        return res.send(cleanedResponse);

    } catch (error) {
        console.error(`[EXAMPLE GENERATION] Error:`, error);
        return res.status(500).json({
            error: `Server error: ${error.message}`,
            status: 'error',
            word: req.body?.word || 'unknown'
        });
    }
});

module.exports = router;
