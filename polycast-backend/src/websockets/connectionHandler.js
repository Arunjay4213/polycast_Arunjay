const url = require('url');
const WebSocket = require('ws'); // Add missing import
const handleWebSocketMessage = require('./messageHandler');
const { activeRooms } = require('../utils/room');
const redisService = require('../services/redisService');

const rejectedRoomCodes = new Set();
const clientTextBuffers = new Map();
const clientTargetLanguages = new Map();
const clientRooms = new Map();

// Memory leak prevention: Clean up rejected room codes periodically
const MAX_REJECTED_CODES = 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function cleanupRejectedCodes() {
    if (rejectedRoomCodes.size > MAX_REJECTED_CODES) {
        console.log(`[Cleanup] Clearing ${rejectedRoomCodes.size} rejected room codes to prevent memory leak`);
        rejectedRoomCodes.clear();
    }
}

// Set up periodic cleanup
const cleanupInterval = setInterval(cleanupRejectedCodes, CLEANUP_INTERVAL);

// Clean up interval on process exit
process.on('SIGINT', () => {
    clearInterval(cleanupInterval);
});
process.on('SIGTERM', () => {
    clearInterval(cleanupInterval);
});

function handleWebSocketConnection(ws, req, heartbeat, isTextMode) {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    const parsedUrl = url.parse(req.url, true);
    const query = parsedUrl.query;

    // Early rejection for known bad room codes
    if (query && query.roomCode && query.isHost === 'false' && rejectedRoomCodes.has(query.roomCode)) {
        console.log(`[Room] Immediately rejected student connection for known bad room code: ${query.roomCode}`);
        ws.send(JSON.stringify({
            type: 'room_error',
            message: 'This room does not exist or has expired. Please check the code and try again.'
        }));
        ws.close();
        return;
    }

    // Connection timeout handler
    const joinRoomTimeout = setTimeout(() => {
        if (!clientRooms.has(ws) && ws.readyState === WebSocket.OPEN) {
            console.log('[Room] Closing connection - timed out waiting to join a room');
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Connection timed out waiting to join a room.'
                }));
            } catch (error) {
                console.error('[Room] Error sending timeout message:', error);
            }
            ws.close();
        }
    }, 60000);

    // Parse target languages with better error handling
    let targetLangsArray = [];
    try {
        if (query && query.targetLangs) {
            targetLangsArray = query.targetLangs
                .split(',')
                .map(lang => decodeURIComponent(lang.trim()))
                .filter(lang => lang.length > 0 && lang.length < 50); // Add length validation
            console.log(`Client connected. Target languages from URL: ${targetLangsArray.join(', ')}`);
        } else {
            console.log(`Client connected. No targetLangs in URL, no languages set`);
        }
    } catch (e) {
        console.error('Error parsing connection URL for target languages:', e);
        targetLangsArray = []; // Fallback to empty array
    }

    // Room handling logic
    if (query && query.roomCode) {
        const roomCode = query.roomCode.toString().trim(); // Ensure string and trim
        const isHost = query.isHost === 'true';

        // Validate room code format (5 digits)
        if (!/^\d{5}$/.test(roomCode)) {
            console.log(`[Room] Invalid room code format: ${roomCode}`);
            ws.send(JSON.stringify({
                type: 'room_error',
                message: 'Invalid room code format. Room codes must be 5 digits.'
            }));
            ws.close();
            return;
        }

        if (!activeRooms.has(roomCode)) {
            if (isHost) {
                activeRooms.set(roomCode, {
                    hostWs: ws,
                    students: [],
                    transcript: [],
                    createdAt: Date.now()
                });
                console.log(`[Room] Host created room on connect: ${roomCode}`);

                // Save to Redis asynchronously
                redisService.saveRoom(roomCode, activeRooms.get(roomCode))
                    .catch(error => console.error(`[Room] Failed to save new room ${roomCode} to Redis:`, error));
            } else {
                console.log(`[Room] Rejected student - room not found: ${roomCode}`);
                rejectedRoomCodes.add(roomCode);
                ws.send(JSON.stringify({
                    type: 'room_error',
                    message: 'Room not found. Please check the code and try again.'
                }));
                ws.close();
                return;
            }
        } else {
            const room = activeRooms.get(roomCode);
            if (isHost) {
                // Check if there's already an active host
                if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
                    console.log(`[Room] Rejected host - room ${roomCode} already has an active host`);
                    ws.send(JSON.stringify({
                        type: 'room_error',
                        message: 'This room already has an active host.'
                    }));
                    ws.close();
                    return;
                }
                room.hostWs = ws;
                console.log(`[Room] Host joined existing room: ${roomCode}`);
            } else {
                // Check for maximum students limit
                const MAX_STUDENTS = 200; // Reasonable limit
                if (room.students.length >= MAX_STUDENTS) {
                    console.log(`[Room] Rejected student - room ${roomCode} is full`);
                    ws.send(JSON.stringify({
                        type: 'room_error',
                        message: 'This room is full. Please try again later.'
                    }));
                    ws.close();
                    return;
                }

                room.students.push(ws);
                console.log(`[Room] Student joined room: ${roomCode} (total students: ${room.students.length})`);

                // Send transcript history if available
                if (room.transcript && room.transcript.length > 0) {
                    try {
                        ws.send(JSON.stringify({
                            type: 'transcript_history',
                            data: room.transcript
                        }));
                    } catch (error) {
                        console.error(`[Room] Error sending transcript history to student:`, error);
                    }
                }
            }
        }

        clientRooms.set(ws, { roomCode, isHost });
        clearTimeout(joinRoomTimeout);

        // Send success message
        try {
            ws.send(JSON.stringify({
                type: 'room_joined',
                roomCode,
                isHost,
                message: isHost ? `You are hosting room ${roomCode}` : `You joined room ${roomCode} as a student`
            }));
        } catch (error) {
            console.error(`[Room] Error sending room_joined message:`, error);
        }
    }

    // Set client data
    clientTargetLanguages.set(ws, targetLangsArray);
    clientTextBuffers.set(ws, { text: '', lastEndTimeMs: 0 });

    // Message handler
    ws.on('message', (message) => {
        try {
            handleWebSocketMessage(ws, message, { clientRooms, clientTargetLanguages, activeRooms, isTextMode });
        } catch (error) {
            console.error('[WebSocket] Error handling message:', error);
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Error processing your message. Please try again.'
                }));
            } catch (sendError) {
                console.error('[WebSocket] Error sending error message:', sendError);
            }
        }
    });

    // Connection close handler
    ws.on('close', async () => {
        clearTimeout(joinRoomTimeout);

        // Clean up Deepgram streaming session if exists
        if (ws.deepgramSession) {
            try {
                console.log('[Cleanup] Closing Deepgram streaming session for disconnected client');
                ws.deepgramSession.close();
                ws.deepgramSession = null;
            } catch (error) {
                console.error('[Cleanup] Error closing Deepgram session:', error);
            }
        }

        const clientRoom = clientRooms.get(ws);
        if (clientRoom) {
            const { roomCode, isHost } = clientRoom;
            const room = activeRooms.get(roomCode);
            if (room) {
                if (isHost) {
                    console.log(`[Room] Host disconnected from room: ${roomCode}`);
                    room.hostWs = null; // Clear the host reference

                    const keepRoomOpen = true;
                    if (!keepRoomOpen) {
                        // Notify all students that host disconnected
                        const hostDisconnectedMessage = JSON.stringify({
                            type: 'host_disconnected',
                            message: 'The host has ended the session.'
                        });

                        room.students.forEach(student => {
                            if (student.readyState === WebSocket.OPEN) {
                                try {
                                    student.send(hostDisconnectedMessage);
                                } catch (error) {
                                    console.error('[Room] Error notifying student of host disconnect:', error);
                                }
                            }
                        });

                        try {
                            await redisService.deleteRoom(roomCode);
                            console.log(`[Room] Successfully deleted room ${roomCode} from Redis`);
                        } catch (error) {
                            console.error(`[Room] Failed to delete room ${roomCode} from Redis:`, error);
                        }
                        activeRooms.delete(roomCode);
                    } else {
                        console.log(`[Room] Keeping room ${roomCode} open even though host disconnected`);
                        try {
                            await redisService.saveRoom(roomCode, room);
                        } catch (error) {
                            console.error(`[Room] Failed to update room ${roomCode} in Redis after host disconnect:`, error);
                        }
                    }
                } else {
                    console.log(`[Room] Student disconnected from room: ${roomCode}`);
                    room.students = room.students.filter(student => student !== ws);
                    console.log(`[Room] Room ${roomCode} now has ${room.students.length} student(s)`);

                    try {
                        await redisService.saveRoom(roomCode, room);
                    } catch (error) {
                        console.error(`[Room] Failed to update room ${roomCode} in Redis after student disconnect:`, error);
                    }
                }
            }
            clientRooms.delete(ws);
        }

        // Clean up client data
        clientTextBuffers.delete(ws);
        clientTargetLanguages.delete(ws);
        console.log('Client disconnected and cleaned up');
    });

    // Error handler
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);

        // Clean up client data on error
        clientTextBuffers.delete(ws);
        clientTargetLanguages.delete(ws);

        // Clean up Deepgram session if exists
        if (ws.deepgramSession) {
            try {
                ws.deepgramSession.close();
                ws.deepgramSession = null;
            } catch (cleanupError) {
                console.error('[Cleanup] Error closing Deepgram session on WebSocket error:', cleanupError);
            }
        }
    });

    // Send welcome message
    try {
        ws.send(JSON.stringify({
            type: 'info',
            message: `Connected to Polycast backend (Targets: ${targetLangsArray.join(', ')})`
        }));
    } catch (error) {
        console.error('[WebSocket] Error sending welcome message:', error);
    }
}

module.exports = handleWebSocketConnection;
