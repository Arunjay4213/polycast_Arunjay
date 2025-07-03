const express = require('express');
const router = express.Router();
const redisService = require('../services/redisService');
// We need access to wss, activeRooms, rejectedRoomCodes, clientRooms from the websocket handler.
// This is tricky. Ideally, the websocket handler would expose functions to perform these actions.
// For now, we'll assume server.js passes them or makes them available.

module.exports = (wss, activeRooms, rejectedRoomCodes, clientRooms) => {
    // Global cleanup admin endpoint
    router.post('/admin/global-cleanup', async (req, res) => {
        const adminKey = req.headers['x-admin-key'];
        if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const connectionsBefore = wss.clients.size;
            let closedConnections = 0;

            wss.clients.forEach(client => {
                const clientRoom = clientRooms.get(client); // clientRooms passed in
                if (!clientRoom || (clientRoom && !clientRoom.isHost && rejectedRoomCodes.has(clientRoom.roomCode))) {
                    if (client.readyState === WebSocket.OPEN) { // Ensure WebSocket is part of ws
                        client.send(JSON.stringify({
                            type: 'admin_terminated',
                            message: 'Your connection has been terminated by an administrator.'
                        }));
                        client.close();
                        closedConnections++;
                    }
                }
            });

            const rejectedBefore = rejectedRoomCodes.size;
            rejectedRoomCodes.clear();

            res.status(200).json({
                success: true,
                message: `Global cleanup completed. Closed ${closedConnections} of ${connectionsBefore} connections. Cleared ${rejectedBefore} rejected room codes.`
            });
        } catch (error) {
            console.error('[Admin] Error performing global cleanup:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Force-terminate a room (admin endpoint)
    router.post('/admin/terminate-room/:roomCode', async (req, res) => {
        const { roomCode } = req.params;
        const adminKey = req.headers['x-admin-key'];
        if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            if (activeRooms.has(roomCode)) {
                const roomData = activeRooms.get(roomCode);
                let disconnectedClients = 0;

                if (roomData.hostWs && roomData.hostWs.readyState === WebSocket.OPEN) { // Ensure WebSocket is imported or available
                    roomData.hostWs.send(JSON.stringify({
                        type: 'room_terminated',
                        message: 'This room has been terminated by an administrator.'
                    }));
                    roomData.hostWs.close();
                    disconnectedClients++;
                }

                roomData.students.forEach(studentWs => {
                    if (studentWs.readyState === WebSocket.OPEN) { // Ensure WebSocket is imported or available
                        studentWs.send(JSON.stringify({
                            type: 'room_terminated',
                            message: 'This room has been terminated by an administrator.'
                        }));
                        studentWs.close();
                        disconnectedClients++;
                    }
                });

                activeRooms.delete(roomCode);
                await redisService.deleteRoom(roomCode);

                return res.status(200).json({
                    success: true,
                    message: `Room ${roomCode} terminated. ${disconnectedClients} active connections closed.`
                });
            } else {
                const exists = await redisService.roomExists(roomCode);
                if (exists) {
                    await redisService.deleteRoom(roomCode);
                    return res.status(200).json({
                        success: true,
                        message: `Room ${roomCode} deleted from persistent storage. No active connections.`
                    });
                } else {
                    return res.status(404).json({
                        success: false,
                        message: `Room ${roomCode} not found`
                    });
                }
            }
        } catch (error) {
            console.error(`[Admin] Error terminating room ${roomCode}:`, error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
};
