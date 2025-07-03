const WebSocket = require('ws');
const url = require('url');
const llmService = require('../services/llmService');
const { transcribeAudio } = require('../services/whisperService');
const redisService = require('../services/redisService'); // Assuming redisService is correctly set up

// Room management system
const activeRooms = new Map(); // Map of roomCode -> {hostWs, students, transcript, createdAt}

// Track client connection attempts - prevent multiple connection spam
const connectionAttempts = new Map(); // This is not used in the provided code, consider removing if not needed

// Global list of all rejected room codes - to prevent reconnection attempts
const rejectedRoomCodes = new Set();

// Client tracking
const clientTextBuffers = new Map();
const clientTargetLanguages = new Map(); // Keep for language from URL, will store an array now
const clientRooms = new Map(); // Track which room each client belongs to

// Heartbeat function to keep connections alive
function heartbeat() {
    this.isAlive = true;
    console.log('Received pong from client');
}

function setupWebSocketServer(server, getIsTextMode) { // Pass isTextMode as a getter function
    const wss = new WebSocket.Server({
        server,
        clientTracking: true,
    });

    // Send pings to all clients every 30 seconds
    const pingInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                console.log('Client did not respond to ping, terminating connection');
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping(() => {}); // Add noop callback for ping
        });
    }, 30000); // 30 seconds ping interval

    wss.on('close', () => {
        clearInterval(pingInterval);
        console.log('WebSocket server closed, cleared ping interval');
    });

    console.log(`WebSocket server created with heartbeat enabled.`);

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', heartbeat);

        const parsedUrl = url.parse(req.url, true);
        const query = parsedUrl.query;
        const isTextMode = getIsTextMode(); // Get current mode

        if (query && query.roomCode && query.isHost === 'false' && rejectedRoomCodes.has(query.roomCode)) {
            console.log(`[Room] Immediately rejected student connection for known bad room code: ${query.roomCode}`);
            ws.send(JSON.stringify({
                type: 'room_error',
                message: 'This room does not exist or has expired. Please check the code and try again.'
            }));
            ws.close();
            return;
        }

        const joinRoomTimeout = setTimeout(() => {
            if (!clientRooms.has(ws) && ws.readyState === ws.OPEN) {
                console.log('[Room] Closing connection - timed out waiting to join a room');
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Connection timed out waiting to join a room.'
                }));
                ws.close();
            }
        }, 60000);

        let targetLangsArray = [];
        try {
            if (query && query.targetLangs) {
                targetLangsArray = query.targetLangs
                    .split(',')
                    .map(lang => decodeURIComponent(lang.trim()))
                    .filter(lang => lang.length > 0);
                if (targetLangsArray.length === 0) {
                    console.log(`Client connected. Invalid targetLangs in URL, no languages set`);
                } else {
                    console.log(`Client connected. Target languages from URL: ${targetLangsArray.join(', ')}`);
                }
            } else {
                console.log(`Client connected. No targetLangs in URL, no languages set`);
            }
        } catch (e) {
            console.error('Error parsing connection URL for target languages:', e);
        }

        let roomCode = null;
        let isHost = false;

        try {
            if (query && query.roomCode) {
                roomCode = query.roomCode;
                isHost = query.isHost === 'true';

                if (!activeRooms.has(roomCode)) {
                    if (isHost) {
                        activeRooms.set(roomCode, {
                            hostWs: ws,
                            students: [],
                            transcript: [],
                            createdAt: Date.now()
                        });
                        console.log(`[Room] Host created room on connect: ${roomCode}`);
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
                        room.hostWs = ws;
                        console.log(`[Room] Host joined existing room: ${roomCode}`);
                    } else {
                        room.students.push(ws);
                        console.log(`[Room] Student joined room: ${roomCode} (total students: ${room.students.length})`);
                        if (room.transcript.length > 0) {
                            ws.send(JSON.stringify({
                                type: 'transcript_history',
                                data: room.transcript
                            }));
                        }
                    }
                }

                clientRooms.set(ws, { roomCode, isHost });
                clearTimeout(joinRoomTimeout);

                ws.send(JSON.stringify({
                    type: 'room_joined',
                    roomCode,
                    isHost,
                    message: isHost ?
                        `You are hosting room ${roomCode}` :
                        `You joined room ${roomCode} as a student`
                }));
            }
        } catch (e) {
            console.error('Error handling room connection:', e);
        }

        clientTargetLanguages.set(ws, targetLangsArray);
        clientTextBuffers.set(ws, { text: '', lastEndTimeMs: 0 });

        ws.on('message', async (message) => {
            console.log('[WS DEBUG] Raw message:', message);
            console.log('[WS DEBUG] typeof message:', typeof message);

            const clientRoomData = clientRooms.get(ws);
            const isInRoom = !!clientRoomData;
            const isRoomHost = isInRoom && clientRoomData.isHost;

            if (isInRoom && !isRoomHost) {
                console.log(`[Room] Rejected message from student in room ${clientRoomData.roomCode}`);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Students cannot send audio or text for transcription'
                }));
                return;
            }

            if (Buffer.isBuffer(message)) {
                try {
                    const msgString = message.toString('utf8');
                    console.log('[WS DEBUG] Buffer as string:', msgString);
                    const data = JSON.parse(msgString);
                    if (data && data.type === 'text_submit') {
                        console.log('[WS DEBUG] Parsed text_submit from buffer:', data);
                        if (isTextMode) { // Use the dynamically fetched isTextMode
                            const translateThis = data.text;
                            const sourceLang = data.lang;
                            const currentTargetLangs = clientTargetLanguages.get(ws) || [];
                            const allLangs = Array.from(new Set(['English', ...currentTargetLangs]));

                            const textModeLLM = require('../services/textModeLLM'); // Ensure this path is correct
                            const translations = await textModeLLM.translateTextBatch(translateThis, sourceLang, allLangs);

                            const hostResponse = {
                                type: 'recognized',
                                lang: sourceLang,
                                data: translateThis
                            };
                            ws.send(JSON.stringify(hostResponse));

                            if (isRoomHost) {
                                const room = activeRooms.get(clientRoomData.roomCode);
                                if (room) {
                                    room.transcript.push({
                                        text: translateThis,
                                        timestamp: Date.now()
                                    });
                                    if (room.transcript.length > 50) {
                                        room.transcript = room.transcript.slice(-50);
                                    }
                                    room.students.forEach(student => {
                                        if (student.readyState === WebSocket.OPEN) {
                                            student.send(JSON.stringify(hostResponse));
                                            for (const lang of allLangs) {
                                                if (lang !== sourceLang) {
                                                    student.send(JSON.stringify({
                                                        type: 'translation',
                                                        lang,
                                                        data: translations[lang]
                                                    }));
                                                }
                                            }
                                        }
                                    });
                                }
                            }

                            for (const lang of allLangs) {
                                if (lang !== sourceLang) {
                                    ws.send(JSON.stringify({
                                        type: 'translation',
                                        lang,
                                        data: translations[lang]
                                    }));
                                }
                            }
                        } else {
                            ws.send(JSON.stringify({ type: 'error', message: 'Text submissions are only allowed in text mode.' }));
                        }
                        return;
                    }
                } catch (err) {
                    console.log('[WS DEBUG] Buffer is not JSON, treating as audio. Error:', err.message);
                }
                console.log(`[Server WS] Received audio buffer, size: ${message.length}`);
                try {
                    const transcription = await transcribeAudio(message, 'audio.webm');
                    if (transcription && ws.readyState === WebSocket.OPEN) {
                        let currentTargetLangs = clientTargetLanguages.get(ws) || [];
                        console.log(`[Polycast] Calling Gemini for batch translation: '${transcription}' -> ${currentTargetLangs.join(', ')}`);
                        const translations = await llmService.translateTextBatch(transcription, currentTargetLangs);

                        const recognizedResponse = {
                            type: 'recognized',
                            data: transcription
                        };
                        ws.send(JSON.stringify(recognizedResponse));

                        if (isRoomHost) {
                            const room = activeRooms.get(clientRoomData.roomCode);
                            if (room) {
                                room.transcript.push({
                                    text: transcription,
                                    timestamp: Date.now()
                                });
                                if (room.transcript.length > 50) {
                                    room.transcript = room.transcript.slice(-50);
                                }
                                room.students.forEach(student => {
                                    if (student.readyState === WebSocket.OPEN) {
                                        student.send(JSON.stringify(recognizedResponse));
                                        for (const lang of currentTargetLangs) {
                                            student.send(JSON.stringify({
                                                type: 'translation',
                                                lang,
                                                data: translations[lang]
                                            }));
                                        }
                                    }
                                });
                                redisService.updateTranscript(clientRoomData.roomCode, room.transcript)
                                    .catch(err => console.error(`[Redis] Failed to update transcript for room ${clientRoomData.roomCode}:`, err));
                            }
                        }

                        for (const lang of currentTargetLangs) {
                            ws.send(JSON.stringify({
                                type: 'translation',
                                lang,
                                data: translations[lang]
                            }));
                        }
                    }
                } catch (err) {
                    console.error('Whisper transcription error:', err);
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Transcription failed: ' + err.message + ' (Try using Chrome or Edge)'
                        }));
                    }
                }
            } else if (typeof message === 'string') {
                console.log('[WS DEBUG] Received string message:', message);
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'text_submit') {
                        console.log('[WS DEBUG] Parsed text_submit from string:', data);
                        if (isTextMode) { // Use the dynamically fetched isTextMode
                            const translateThis = data.text;
                            const sourceLang = data.lang;
                            const currentTargetLangs = clientTargetLanguages.get(ws) || [];
                            const allLangs = Array.from(new Set(['English', ...currentTargetLangs]));

                            const textModeLLM = require('../services/textModeLLM'); // Ensure this path is correct
                            const translations = await textModeLLM.translateTextBatch(translateThis, sourceLang, allLangs);

                            ws.send(JSON.stringify({ type: 'recognized', lang: sourceLang, data: translateThis }));

                            for (const lang of allLangs) {
                                if (lang !== sourceLang) {
                                    ws.send(JSON.stringify({ type: 'translation', lang, data: translations[lang] }));
                                }
                            }
                            // Broadcast to students if this is a host in a room
                            if (isRoomHost) {
                                const room = activeRooms.get(clientRoomData.roomCode);
                                if (room) {
                                     room.transcript.push({
                                        text: translateThis, // Store original text
                                        timestamp: Date.now()
                                    });
                                    if (room.transcript.length > 50) {
                                        room.transcript = room.transcript.slice(-50);
                                    }
                                    room.students.forEach(student => {
                                        if (student.readyState === WebSocket.OPEN) {
                                            // Send recognized original text
                                            student.send(JSON.stringify({ type: 'recognized', lang: sourceLang, data: translateThis }));
                                            // Send translations
                                            for (const lang of allLangs) {
                                                if (lang !== sourceLang) {
                                                    student.send(JSON.stringify({ type: 'translation', lang, data: translations[lang] }));
                                                }
                                            }
                                        }
                                    });
                                    redisService.updateTranscript(clientRoomData.roomCode, room.transcript)
                                        .catch(err => console.error(`[Redis] Failed to update transcript for room ${clientRoomData.roomCode}:`, err));
                                }
                            }

                        } else {
                             // This case (string message, not text_submit, audio mode) was not fully handled before.
                            // For now, we'll assume it's an error or unexpected message type in audio mode.
                            console.warn('[Server] Received string message in audio mode that is not text_submit, ignoring.');
                            // ws.send(JSON.stringify({ type: 'error', message: 'Text submissions are only allowed in text mode.' }));
                        }
                    }
                } catch (err) {
                    console.error('Failed to parse or handle text_submit from string:', err);
                     // If JSON.parse fails, it's not a 'text_submit' or other known command.
                    console.warn('[Server] Received unparseable/unknown string message, ignoring.');
                }
            } else {
                console.warn('[Server] Received unexpected non-buffer/non-string message, ignoring.');
            }
        });

        ws.on('close', async () => {
            clearTimeout(joinRoomTimeout);
            const clientRoomData = clientRooms.get(ws);
            if (clientRoomData) {
                const { roomCode: currentRoomCode, isHost: currentIsHost } = clientRoomData;
                const room = activeRooms.get(currentRoomCode);
                if (room) {
                    if (currentIsHost) {
                        console.log(`[Room] Host disconnected from room: ${currentRoomCode}`);
                        const keepRoomOpen = true;
                        if (!keepRoomOpen) {
                            console.log(`[Room] Closing room ${currentRoomCode} as no host remains`);
                            room.students.forEach(student => {
                                if (student.readyState === WebSocket.OPEN) {
                                    student.send(JSON.stringify({
                                        type: 'host_disconnected',
                                        message: 'The host has ended the session.'
                                    }));
                                }
                            });
                            try {
                                await redisService.deleteRoom(currentRoomCode);
                                console.log(`[Room] Successfully deleted room ${currentRoomCode} from Redis`);
                            } catch (error) {
                                console.error(`[Room] Failed to delete room ${currentRoomCode} from Redis:`, error);
                            }
                            activeRooms.delete(currentRoomCode);
                        } else {
                            console.log(`[Room] Keeping room ${currentRoomCode} open even though host disconnected`);
                            try {
                                await redisService.saveRoom(currentRoomCode, room); // Save potentially updated room state (e.g. transcript)
                            } catch (error) {
                                console.error(`[Room] Failed to update room ${currentRoomCode} in Redis after host disconnect:`, error);
                            }
                        }
                    } else {
                        console.log(`[Room] Student disconnected from room: ${currentRoomCode}`);
                        room.students = room.students.filter(student => student !== ws);
                        console.log(`[Room] Room ${currentRoomCode} now has ${room.students.length} student(s)`);
                        try {
                            await redisService.saveRoom(currentRoomCode, room);
                        } catch (error) {
                            console.error(`[Room] Failed to update room ${currentRoomCode} in Redis after student disconnect:`, error);
                        }
                    }
                }
                clientRooms.delete(ws);
            }
            clientTextBuffers.delete(ws);
            clientTargetLanguages.delete(ws);
            console.log('Client disconnected');
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            // Cleanup client data on error as well
            clearTimeout(joinRoomTimeout); // Clear timeout if it was set
            const clientRoomData = clientRooms.get(ws);
            if (clientRoomData) {
                clientRooms.delete(ws);
            }
            clientTextBuffers.delete(ws);
            clientTargetLanguages.delete(ws);
        });

        ws.send(JSON.stringify({ type: 'info', message: `Connected to Polycast backend (Targets: ${targetLangsArray.join(', ')})` }));
    });

    // Room cleanup interval - moved here to be part of the WebSocket setup
    const roomCleanupInterval = setInterval(() => {
        console.log('[Cleanup] Running room cleanup check');
        const now = Date.now();
        const MAX_ROOM_AGE_MS = 60 * 60 * 1000; // 60 minutes

        for (const [roomCode, roomData] of activeRooms.entries()) {
            const roomAge = now - (roomData.createdAt || 0); // Add fallback for createdAt

            if (roomAge > MAX_ROOM_AGE_MS) {
                console.log(`[Cleanup] Removing inactive room: ${roomCode} (age: ${Math.floor(roomAge / 60000)} minutes)`);

                if (roomData.hostWs && roomData.hostWs.readyState === WebSocket.OPEN) {
                    roomData.hostWs.send(JSON.stringify({
                        type: 'room_expired',
                        message: 'This room has expired due to inactivity.'
                    }));
                    roomData.hostWs.close();
                }

                roomData.students.forEach(studentWs => {
                    if (studentWs.readyState === WebSocket.OPEN) {
                        studentWs.send(JSON.stringify({
                            type: 'room_expired',
                            message: 'This room has expired due to inactivity.'
                        }));
                        studentWs.close();
                    }
                });

                activeRooms.delete(roomCode);
                redisService.deleteRoom(roomCode).catch(err => console.error(`[Cleanup] Error deleting room ${roomCode} from Redis:`, err));
            }
        }
    }, 60000); // Run every minute

    // Ensure cleanup interval is cleared when wss closes
     wss.on('close', () => { // This might be redundant if already defined, ensure it's handled once
        clearInterval(roomCleanupInterval);
        console.log('WebSocket server closed, cleared room cleanup interval');
    });


    return wss; // Return the wss instance
}

// Export activeRooms and rejectedRoomCodes so they can be accessed by roomRoutes.js if needed
// generateRoomCode will also need access to these, or they need to be passed to it.
// For now, routes will handle room creation logic that might interact with these.
module.exports = {
    setupWebSocketServer,
    activeRooms,
    rejectedRoomCodes,
    // Expose clientRooms if admin routes need to inspect/modify it directly, though it's better via functions
};
