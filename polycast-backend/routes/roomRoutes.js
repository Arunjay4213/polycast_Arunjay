const express = require('express');
const router = express.Router();
const { generateRoomCode } = require('../utils/utils'); // Assuming utils.js exports this
const redisService = require('../services/redisService');
const { activeRooms, rejectedRoomCodes } = require('../websocket/handler'); // Import from websocket handler

// Create a new room (HOST endpoint)
router.post('/create-room', async (req, res) => {
    try {
        // generateRoomCode needs access to activeRooms and redisService.
        // We can modify generateRoomCode to accept these as parameters,
        // or ensure it can access them if they are module-scoped in utils.js (less ideal).
        // For now, assuming generateRoomCode can somehow check them or we adapt it.
        // Let's adapt generateRoomCode to take activeRooms and redisService as arguments.
        const roomCode = await generateRoomCode(activeRooms, redisService); // Pass them here

        const roomData = {
            hostWs: null,
            students: [],
            transcript: [],
            createdAt: Date.now()
        };

        activeRooms.set(roomCode, roomData);
        await redisService.saveRoom(roomCode, roomData);

        console.log(`[Room] Created new room: ${roomCode}`);
        res.status(201).json({ roomCode });
    } catch (error) {
        console.error('[Room] Error creating room:', error);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Check if a room exists (STUDENT endpoint)
router.get('/check-room/:roomCode', async (req, res) => {
    const { roomCode } = req.params;

    if (activeRooms.has(roomCode)) {
        console.log(`[Room] Room check success (memory): ${roomCode}`);
        res.status(200).json({ exists: true });
        return;
    }

    try {
        const exists = await redisService.roomExists(roomCode);
        if (exists) {
            const roomDataFromRedis = await redisService.getRoom(roomCode); // Renamed to avoid conflict
            activeRooms.set(roomCode, {
                hostWs: null,
                students: [],
                transcript: roomDataFromRedis.transcript || [],
                createdAt: roomDataFromRedis.createdAt || Date.now()
            });
            console.log(`[Room] Room check success (redis): ${roomCode}`);
            res.status(200).json({ exists: true });
        } else {
            console.log(`[Room] Room check failed - not found: ${roomCode}`);
            // Add to rejectedRoomCodes if a student is checking a non-existent room.
            // This helps the WebSocket handler to immediately reject connections to known bad rooms.
            // However, this should ideally only happen if it's a student check,
            // not if a host is trying to re-establish. For now, we'll add it.
            rejectedRoomCodes.add(roomCode);
            res.status(404).json({ exists: false, message: 'Room not found' });
        }
    } catch (error) {
        console.error(`[Room] Error checking room ${roomCode}:`, error);
        res.status(500).json({ error: 'Failed to check room' });
    }
});

module.exports = router;
