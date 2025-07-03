const fs = require('fs');
const path = require('path');
const MODE_FILE = path.join(__dirname, '../mode.json'); // Adjusted path

// Helper to load mode from disk
function loadModeFromDisk() {
    try {
        if (fs.existsSync(MODE_FILE)) {
            const data = JSON.parse(fs.readFileSync(MODE_FILE, 'utf8'));
            if (typeof data.isTextMode === 'boolean') {
                console.log(`[Mode] Loaded isTextMode=${data.isTextMode} from disk`);
                return data.isTextMode;
            }
        }
    } catch (e) {
        console.warn('[Mode] Failed to read mode.json:', e);
    }
    return false;
}

// Helper to save mode to disk
function saveModeToDisk(isTextMode) {
    try {
        fs.writeFileSync(MODE_FILE, JSON.stringify({ isTextMode }), 'utf8');
        console.log(`[Mode] Saved isTextMode=${isTextMode} to disk`);
    } catch (e) {
        console.error('[Mode] Failed to save mode.json:', e);
    }
}

// Generate a unique 5-digit room code
async function generateRoomCode(activeRooms, redisService) {
    // Try up to 5 times to generate a unique code
    for (let attempts = 0; attempts < 5; attempts++) {
        const code = Math.floor(10000 + Math.random() * 90000).toString(); // 5-digit number

        // Check both in-memory map and Redis
        if (!activeRooms.has(code) && !(await redisService.roomExists(code))) {
            return code;
        }
    }

    // If we couldn't generate a unique code after 5 attempts, try a more systematic approach
    let code = 10000;
    while (code < 100000) {
        if (!activeRooms.has(code.toString()) && !(await redisService.roomExists(code.toString()))) {
            return code.toString();
        }
        code++;
    }

    throw new Error('Failed to generate a unique room code');
}

// String similarity function for matching definitions
function stringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    // Convert both strings to lowercase for case-insensitive comparison
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    // Check if one string contains the other
    if (s1.includes(s2) || s2.includes(s1)) {
        return 0.8; // High similarity if one contains the other
    }

    // Split into words and check for word overlap
    const words1 = s1.split(/\W+/).filter(w => w.length > 2); // Only consider words with 3+ chars
    const words2 = s2.split(/\W+/).filter(w => w.length > 2);

    let matches = 0;
    for (const word1 of words1) {
        if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
            matches++;
        }
    }

    // Calculate similarity based on matched words vs total words
    const totalWords = Math.max(words1.length, words2.length);
    return totalWords > 0 ? matches / totalWords : 0;
}

module.exports = {
    loadModeFromDisk,
    saveModeToDisk,
    generateRoomCode,
    stringSimilarity
};
