// Placeholder test file

describe('Server Setup', () => {
  test('should pass this basic test', () => {
    expect(true).toBe(true);
  });
});

const request = require('supertest');
const WebSocket = require('ws');
const sdk = require('microsoft-cognitiveservices-speech-sdk'); // Import SDK for ResultReason
const { server, wss } = require('../server'); // Import the exported server and wss
const config = require('../config/config');

// Mock the spawn function from child_process used for FFmpeg
jest.mock('child_process', () => ({
    spawn: jest.fn(() => ({
        pid: 12345, // Mock PID
        stdin: { pipe: jest.fn(), on: jest.fn(), end: jest.fn() },
        stdout: { pipe: jest.fn(), on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
             // Immediately trigger 'close' for simplicity in some tests if needed,
             // or setup specific triggers per test case.
             // if (event === 'close') {
             //     setTimeout(() => cb(0, null), 10); // Simulate clean exit shortly after spawn
             // }
        }),
        kill: jest.fn(),
    })),
}));

// Silence console logs/errors during tests unless needed for debugging
let consoleLogSpy;
let consoleErrorSpy;
// beforeEach(() => {
//     consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
//     consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
// });
// afterEach(() => {
//     consoleLogSpy.mockRestore();
//     consoleErrorSpy.mockRestore();
//     jest.restoreAllMocks(); // Restore other mocks too
// });

// Increase Jest timeout for async operations like server start/stop
jest.setTimeout(10000); // 10 seconds

describe('Server WebSocket Communication', () => {
    let testServer;
    let wsClient;

    // Start the server before running tests
    beforeAll((done) => {
        // Ensure any previous instance is closed before starting
        server.close(() => {
            testServer = server.listen(config.port, done);
        });
        // Handle case where server wasn't running initially
        server.on('error', (err) => {
            if (err.code === 'ERR_SERVER_NOT_RUNNING') {
                testServer = server.listen(config.port, done);
            } else {
                done(err);
            }
        });
    });

    // Close the server and WebSocket client after tests
    afterAll((done) => {
        wss.clients.forEach(client => client.terminate()); // Terminate any open WS clients
        wss.close(() => { // Close the WebSocket server
            if (testServer) {
                testServer.close(done); // Close the HTTP server
            } else {
                done(); // Server might not have started if beforeAll failed
            }
        });
    });

    // Ensure mocks are cleared and client connected before each test
    beforeEach(async () => { // Make beforeEach async
        jest.clearAllMocks();

        await new Promise((resolve, reject) => {
            const wsUrl = `ws://localhost:${config.port}`;
            wsClient = new WebSocket(wsUrl);
            wsClient.on('open', () => {
                resolve(); // Resolve once the WebSocket connection is open
            });
            wsClient.on('error', (err) => reject(err));
        });
    });

    // Close WebSocket client after each test
    afterEach(() => {
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
            wsClient.close();
        }
        if (consoleLogSpy) consoleLogSpy.mockRestore(); // Restore console.log
    });

    test('GET / should return 200 OK', async () => {
        const response = await request(testServer).get('/');
        expect(response.statusCode).toBe(200);
        expect(response.text).toBe('Polycast Backend Server is running.');
    });

    test('WebSocket connection established and receives info message', (done) => {
        let infoMessageReceived = false;
        wsClient.on('message', (message) => {
            try {
                const parsedMessage = JSON.parse(message.toString());
                if (parsedMessage.type === 'info') {
                    expect(parsedMessage.message).toContain('Connected to Polycast backend');
                    infoMessageReceived = true;
                    done(); // Test complete once info message is verified
                }
            } catch (error) {
                done(error);
            }
        });
        // Timeout if info message isn't received
        setTimeout(() => {
             if (!infoMessageReceived) done(new Error('Info message not received'));
        }, 200);
    });

    // Remove the old Whisper test
    // test('WebSocket should process received audio message via WhisperService', ...);
});
