// Redis service for room persistence using ioredis
const Redis = require('ioredis');
const config = require('../config/config');
let redis;

// Check if Redis environment variable is configured
const hasRedisConfig = config.redisUrl;

// Create Redis client only if environment variable is available
if (hasRedisConfig) {
    try {
        redis = new Redis(config.redisUrl);

        // Add connection event handlers to properly handle async connection errors
        redis.on('connect', () => {
            console.log('[Redis] Successfully connected to Redis server');
        });

        redis.on('ready', () => {
            console.log('[Redis] Redis client is ready to receive commands');
        });

        redis.on('error', (error) => {
            console.error('[Redis] Connection error:', error);
            // Don't set redis to null here as it might recover
            // Just log the error and let the client handle reconnection
        });

        redis.on('close', () => {
            console.warn('[Redis] Connection to Redis server closed');
        });

        redis.on('reconnecting', () => {
            console.log('[Redis] Attempting to reconnect to Redis server');
        });

        console.log('[Redis] Redis client initialized, attempting connection...');
    } catch (error) {
        console.error('[Redis] Error initializing Redis client:', error);
        redis = null;
    }
} else {
    console.log('[Redis] No REDIS_URL configured. Running in memory-only mode (rooms won\'t persist across restarts).');
}

// Room prefix to organize keys
const ROOM_PREFIX = 'polycast:room:';

// Room expiration in seconds (12 hours)
const ROOM_EXPIRY = 12 * 60 * 60;

/**
 * Check if Redis is available and connected
 * @returns {boolean} - Whether Redis is available for operations
 */
function isRedisAvailable() {
    return redis && redis.status === 'ready';
}

/**
 * Save room data to Redis
 * @param {string} roomCode - The room's unique code
 * @param {Object} roomData - Room data to save (without WebSocket connections)
 */
async function saveRoom(roomCode, roomData) {
    // Skip if Redis is not available
    if (!isRedisAvailable()) {
        console.log(`[Redis] Skipping save for room ${roomCode} - Redis not available`);
        return true; // Silently succeed when running without Redis
    }

    try {
        // Create a serializable version of room data (remove WS objects)
        const serializableRoom = {
            isActive: true,
            hasHost: !!roomData.hostWs,
            studentCount: roomData.students ? roomData.students.length : 0,
            transcript: roomData.transcript || [],
            createdAt: roomData.createdAt || Date.now(),
            lastActivity: Date.now()
        };

        // Save to Redis with expiration
        await redis.set(
            `${ROOM_PREFIX}${roomCode}`,
            JSON.stringify(serializableRoom),
            'EX', // Use EX instead of object syntax for better compatibility
            ROOM_EXPIRY
        );

        console.log(`[Redis] Saved room ${roomCode} to Redis`);
        return true;
    } catch (error) {
        console.error(`[Redis] Error saving room ${roomCode}:`, error);
        return false;
    }
}

/**
 * Check if a room exists in Redis
 * @param {string} roomCode - The room's unique code
 * @returns {Promise<boolean>} - Whether the room exists
 */
async function roomExists(roomCode) {
    // Skip if Redis is not available
    if (!isRedisAvailable()) {
        return false; // Assume room doesn't exist in Redis when Redis is unavailable
    }

    try {
        const exists = await redis.exists(`${ROOM_PREFIX}${roomCode}`);
        return !!exists;
    } catch (error) {
        console.error(`[Redis] Error checking room ${roomCode}:`, error);
        return false;
    }
}

/**
 * Get room data from Redis
 * @param {string} roomCode - The room's unique code
 * @returns {Promise<Object|null>} - Room data or null if not found
 */
async function getRoom(roomCode) {
    // Skip if Redis is not available
    if (!isRedisAvailable()) {
        return null; // Return null when Redis is unavailable
    }

    try {
        const data = await redis.get(`${ROOM_PREFIX}${roomCode}`);
        if (!data) return null;

        return JSON.parse(data);
    } catch (error) {
        console.error(`[Redis] Error getting room ${roomCode}:`, error);
        return null;
    }
}

/**
 * Delete a room from Redis
 * @param {string} roomCode - The room's unique code
 */
async function deleteRoom(roomCode) {
    // Skip if Redis is not available
    if (!isRedisAvailable()) {
        return true; // Silently succeed when running without Redis
    }

    try {
        await redis.del(`${ROOM_PREFIX}${roomCode}`);
        console.log(`[Redis] Deleted room ${roomCode} from Redis`);
        return true;
    } catch (error) {
        console.error(`[Redis] Error deleting room ${roomCode}:`, error);
        return false;
    }
}

/**
 * Update a room's transcript in Redis
 * @param {string} roomCode - The room's unique code
 * @param {Array} transcript - The updated transcript array
 */
async function updateTranscript(roomCode, transcript) {
    // Skip if Redis is not available
    if (!isRedisAvailable()) {
        return true; // Silently succeed when running without Redis
    }

    try {
        const roomData = await getRoom(roomCode);
        if (!roomData) return false;

        roomData.transcript = transcript;
        roomData.lastActivity = Date.now();

        await redis.set(
            `${ROOM_PREFIX}${roomCode}`,
            JSON.stringify(roomData),
            'EX', // Use EX instead of object syntax for better compatibility
            ROOM_EXPIRY
        );

        return true;
    } catch (error) {
        console.error(`[Redis] Error updating transcript for room ${roomCode}:`, error);
        return false;
    }
}

/**
 * Get all active rooms
 * @returns {Promise<Array>} - Array of room codes
 */
async function getAllRooms() {
    // Skip if Redis is not available
    if (!isRedisAvailable()) {
        return []; // Return empty array when Redis is unavailable
    }

    try {
        const keys = await redis.keys(`${ROOM_PREFIX}*`);
        return keys.map(key => key.replace(ROOM_PREFIX, ''));
    } catch (error) {
        console.error('[Redis] Error getting all rooms:', error);
        return [];
    }
}

module.exports = {
    saveRoom,
    roomExists,
    getRoom,
    deleteRoom,
    updateTranscript,
    getAllRooms,
    isRedisAvailable // Export for debugging/monitoring
};
