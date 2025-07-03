const axios = require('axios');
const FormData = require('form-data');
const { transcribeAudio } = require('../services/whisperService');
const config = require('../config/config'); // Need to potentially mock this too

// Mock the axios module
jest.mock('axios');

// Mock the config module partially or completely if needed
jest.mock('../config/config', () => ({
    // Keep original values
    // ...jest.requireActual('../config/config'),
    // Set a mock API key for testing
    openaiApiKey: 'test_openai_key',
    // Use a specific port for consistency if needed, though not directly used here
    port: 8088,
}));

// Mock console methods to avoid cluttering test output
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
    jest.restoreAllMocks();
});

describe('Whisper Service - transcribeAudio', () => {
    let mockAudioBuffer;

    beforeEach(() => {
        // Reset mocks before each test
        axios.post.mockClear();
        mockAudioBuffer = Buffer.from('fake audio data'); // Simple buffer for testing
    });

    test('should call Whisper API with correct parameters and return transcription', async () => {
        const mockResponse = { data: { text: 'Hello world' } };
        axios.post.mockResolvedValue(mockResponse);

        const transcription = await transcribeAudio(mockAudioBuffer, 'test.wav');

        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith(
            'https://api.openai.com/v1/audio/transcriptions',
            expect.any(FormData), // Check that FormData is passed
            {
                headers: expect.objectContaining({
                    'Authorization': `Bearer ${config.openaiApiKey}`,
                    // Expect form-data headers to be included
                    'content-type': expect.stringContaining('multipart/form-data'),
                }),
                maxBodyLength: Infinity,
            }
        );

        // More detailed check on FormData content if necessary (can be complex)
        const formData = axios.post.mock.calls[0][1];
        // console.log(formData.getBuffer().toString()); // This can help debug form content

        expect(transcription).toBe('Hello world');
    });

    test('should throw error if OpenAI API key is not configured', async () => {
        // Temporarily set the key to undefined on the mocked config
        const originalKey = config.openaiApiKey;
        config.openaiApiKey = undefined;

        await expect(transcribeAudio(mockAudioBuffer)).rejects.toThrow(
            'OpenAI API key is not configured.'
        );
        expect(axios.post).not.toHaveBeenCalled();

        // Restore the key
        config.openaiApiKey = originalKey;
    });

    test('should throw error if audio buffer is empty or invalid', async () => {
        await expect(transcribeAudio(null)).rejects.toThrow(
            'Audio buffer is empty or invalid.'
        );
        await expect(transcribeAudio(Buffer.from(''))).rejects.toThrow(
            'Audio buffer is empty or invalid.'
        );
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('should handle API error response', async () => {
        const errorResponse = {
            response: {
                status: 401,
                data: { error: { message: 'Invalid API key' } },
            },
        };
        axios.post.mockRejectedValue(errorResponse);

        await expect(transcribeAudio(mockAudioBuffer)).rejects.toThrow(
            'Whisper API Error: Invalid API key'
        );
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

     test('should handle network or other axios errors', async () => {
        const networkError = new Error('Network Error');
        axios.post.mockRejectedValue(networkError);

        await expect(transcribeAudio(mockAudioBuffer)).rejects.toThrow(
            'Whisper API Error: Network Error'
        );
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    test('should handle unexpected API response format', async () => {
        const unexpectedResponse = { data: { something_else: 'unexpected' } }; // No 'text' field
        axios.post.mockResolvedValue(unexpectedResponse);

        await expect(transcribeAudio(mockAudioBuffer)).rejects.toThrow(
            'Unexpected response format from Whisper API.'
        );
        expect(axios.post).toHaveBeenCalledTimes(1);
    });
});
