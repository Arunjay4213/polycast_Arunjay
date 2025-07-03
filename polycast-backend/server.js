// Basic server setup
require('dotenv').config();
console.log('Server starting...');

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path'); // Required for MODE_FILE path in utils

// Configuration
const config = require('./config/config'); // Primarily for port and Google API Key

// Utilities
const { loadModeFromDisk, saveModeToDisk } = require('./utils/utils');
// generateTextWithGemini is used by dictionaryRoutes and profileRoutes directly from geminiUtils.js
// getDefaultLanguageForProfile is used by profileRoutes directly from profileUtils.js
// stringSimilarity is not directly used in server.js after refactor

// Database
const { pool, initializeDatabase } = require('./db'); // Pool is used by various routes

// WebSocket
const { setupWebSocketServer, activeRooms, rejectedRoomCodes, clientRooms } = require('./websocket/handler'); // Import necessary exports

// Services (some might be used by routes directly, ensure they are available)
// llmService, whisperService, imageService, redisService, textModeLLM are used by routes/websocket handler

// Initialize Express app
const app = express();

// CORS Middleware
app.use((req, res, next) => {
    console.log(`[CORS] Request from origin: ${req.headers.origin}`);
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Admin-Key'); // Added X-Admin-Key
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
    console.log(`[CORS] Response headers set:`, {
        'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
        'Access-Control-Allow-Credentials': res.getHeader('Access-Control-Allow-Credentials')
    });
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200); // Handle preflight requests
    }
    next();
});

// Additional CORS configuration if needed (e.g., for specific origins in production)
// app.use(cors({
//   origin: 'your-frontend-domain.com', // Replace with your actual frontend domain
//   credentials: true
// }));


// Body Parsing Middleware
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// === Polycast Mode State ===
let isTextMode = loadModeFromDisk();

const getIsTextMode = () => isTextMode;
const setIsTextMode = (newMode) => { isTextMode = newMode; };


// Setup WebSocket server
// Pass the http server and a getter for isTextMode
const wss = setupWebSocketServer(server, getIsTextMode);


// API Routes
const roomRoutes = require('./routes/roomRoutes');
const translationRoutes = require('./routes/translationRoutes');
const dictionaryRoutes = require('./routes/dictionaryRoutes');
const profileRoutes = require('./routes/profileRoutes');
const imageRoutes = require('./routes/imageRoutes');
const audioRoutes = require('./routes/audioRoutes');

// Route setup that requires passing state/variables
const modeRouter = require('./routes/modeRoutes')(getIsTextMode, setIsTextMode, saveModeToDisk);
const adminRouter = require('./routes/adminRoutes')(wss, activeRooms, rejectedRoomCodes, clientRooms);


app.use('/api', roomRoutes); // e.g. /api/create-room
app.use('/api', translationRoutes); // e.g. /api/translate/...
app.use('/api', dictionaryRoutes); // e.g. /api/dictionary/...
app.use('/api', profileRoutes); // e.g. /api/profile/...
app.use('/api', imageRoutes); // e.g. /api/generate-image
app.use('/api', audioRoutes); // e.g. /api/audio/...
app.use('/', modeRouter); // e.g. /mode
app.use('/api', adminRouter); // e.g. /api/admin/global-cleanup


// Basic health check endpoint
app.get('/', (req, res) => {
    res.status(200).send('Polycast Backend Server is running.');
});

// Initialize database and start server
const PORT = process.env.PORT || config.port || 3000;

initializeDatabase()
    .then(() => {
        console.log('[Database] Initialization completed successfully after refactor check');
        return pool.connect(); // Test connection
    })
    .then(client => {
        console.log('[Database] Connection test successful after initialization');
        return client.query('SELECT current_timestamp AS server_time')
            .then(result => {
                console.log('[Database] Test query successful, server time:', result.rows[0].server_time);
                client.release();
                // Start the HTTP server only after DB is confirmed working
                server.listen(PORT, () => {
                    console.log(`HTTP server listening on port ${PORT}`);
                });
            })
            .catch(err => {
                console.error('[Database] Test query failed:', err);
                client.release();
                // Optionally, decide if server should start if DB test query fails
                // For now, let's log and proceed to start server anyway
                server.listen(PORT, () => {
                    console.log(`HTTP server listening on port ${PORT} (DB test query failed but proceeding)`);
                });
            });
    })
    .catch(err => {
        console.error('[Database] Initialization or connection test failed:', err);
        // Decide if server should start if DB init fails
        // For now, let's log and proceed to start server anyway for basic functionality
        server.listen(PORT, () => {
            console.log(`HTTP server listening on port ${PORT} (DB initialization failed but proceeding)`);
        });
    });


// Graceful shutdown
process.on('SIGTERM', () => {
    console.info('SIGTERM signal received: closing HTTP server');
    if (wss) {
        wss.close(() => {
            console.log('WebSocket server closed');
        });
    }
    server.close(() => {
        console.log('HTTP server closed');
        if (pool) {
            pool.end(() => {
                console.log('Database pool closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });
});

// Export for testing purposes (if any tests depend on these)
module.exports = { server, wss, app, pool };
