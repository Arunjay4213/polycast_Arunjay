const deepl = require('deepl-node');
const config = require('../config/config');

// Cache the translator instance
let translatorInstance = null;

/**
 * Function to initialize and get the translator instance (memoized)
 * @returns {deepl.Translator} The initialized translator instance.
 * @throws {Error} If the DeepL API key is not configured or initialization fails.
 */
const getTranslator = () => {
    // Return cached instance if available
    if (translatorInstance) {
        return translatorInstance;
    }

    // Check if the DeepL API key is configured
    if (!config.deeplAuthKey) {
        const errMsg = 'DeepL API key (DEEPL_AUTH_KEY) is not configured.';
        console.error(errMsg);
        throw new Error(errMsg);
    }

    try {
        // Initialize translator only if the key exists
        translatorInstance = new deepl.Translator(config.deeplAuthKey);
        console.log('DeepL Translator initialized successfully.');
        return translatorInstance;
    } catch (error) {
        console.error('Failed to initialize DeepL Translator:', error);
        // Ensure translatorInstance remains null if init fails
        translatorInstance = null;
        throw new Error(`Failed to initialize DeepL Translator: ${error.message}`);
    }
}; //stuff above this looks good

/**
 * Translates a single sentence using the DeepL API.
 * @param {string} text The text to translate.
 * @param {deepl.TargetLanguageCode} targetLang The target language code (e.g., 'DE', 'FR').
 * @param {deepl.SourceLanguageCode} [sourceLang=null] Optional source language code (e.g., 'EN'). If null or omitted, DeepL auto-detects.
 * @returns {Promise<string>} The translated text.
 * @throws {Error} If the DeepL client is not initialized or the API call fails.
 */
async function translateSentence(text, targetLang, sourceLang = null) {
    // Handle empty input first, avoid unnecessary API calls/init
    if (!text || text.trim().length === 0) {
        console.warn('translateSentence called with empty text.');
        return '';
    } 

    // Now get the translator instance
    const translator = getTranslator(); // Ensures translator is initialized

    // Basic check for potentially supported languages by deepl-node library
    // Note: DeepL Free API might have further restrictions (e.g., MY might not work on Free tier)
    const validTargetLangs = ['ES', 'ZH', 'MY']; // Add other supported codes as needed
    if (!validTargetLangs.includes(targetLang)) {
        console.warn(`Target language "${targetLang}" may not be supported or is invalid.`);
        // Depending on desired behavior, either throw or return original text/empty string
        // Let's try the API call anyway, DeepL might handle it or return an error
    }

    console.log(`Translating "${text.substring(0, 20)}..." to ${targetLang} using DeepL...`);

    try {
        console.log(`Requesting translation to ${targetLang}...`);
        const result = await translator.translateText(text, sourceLang, targetLang);
        console.log(`Translation successful for targetLang ${targetLang}.`);
        return result.text;
    } catch (error) {
        console.error(`Error translating text to ${targetLang} using DeepL:`, error);
        // Enhance error message based on potential DeepL errors
        let errorMessage = error.message || 'Failed to translate text.';
        if (error instanceof deepl.QuotaExceededError) {
            errorMessage = 'DeepL quota exceeded.';
        } else if (error instanceof deepl.AuthorizationError) {
            errorMessage = 'DeepL authorization failed. Check API key.';
        } else if (error.message && error.message.includes('Target language not supported')) {
            errorMessage = `DeepL does not support target language: ${targetLang}`;
        }
        // We re-throw so the calling function knows translation failed
        throw new Error(`DeepL API Error (${targetLang}): ${errorMessage}`);
    }
}

module.exports = {
    translateSentence,
    getTranslator, // Export for potential direct use or testing if needed
};
