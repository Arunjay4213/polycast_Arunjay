const { Pool } = require('pg');

// Database connection using environment variables or direct connection string
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://data_5rgr_user:3mDZqEEuOVr3SzkyO1M8UvvAvTdkdNQI@dpg-d0jn3fvfte5s7380vqs0-a.oregon-postgres.render.com/data_5rgr',
    ssl: {
        rejectUnauthorized: false // Required for Render PostgreSQL
    }
});

// Initialize the database tables
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        // Create profiles table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS profiles (
                profile_name VARCHAR(255) PRIMARY KEY,
                selected_words TEXT[],
                last_updated TIMESTAMP DEFAULT NOW()
            )
        `);

        // Create flashcards table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS flashcards (
                id SERIAL PRIMARY KEY,
                profile_name VARCHAR(255) REFERENCES profiles(profile_name) ON DELETE CASCADE,
                word_sense_id VARCHAR(255) NOT NULL,
                word VARCHAR(255) NOT NULL,
                definition TEXT,
                translation TEXT,
                part_of_speech VARCHAR(50),
                context TEXT,
                definition_number INTEGER,
                example TEXT,
                in_flashcards BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(profile_name, word_sense_id)
            )
        `);

        // Create audio_cache table for storing generated audio files
        await client.query(`
            CREATE TABLE IF NOT EXISTS audio_cache (
                id SERIAL PRIMARY KEY,
                card_key VARCHAR(255) NOT NULL UNIQUE,
                text_content TEXT NOT NULL,
                audio_data BYTEA NOT NULL,
                content_type VARCHAR(50) DEFAULT 'audio/mpeg',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Create srs_daily table for tracking daily SRS statistics
        await client.query(`
            CREATE TABLE IF NOT EXISTS srs_daily (
                profile_name VARCHAR(255) REFERENCES profiles(profile_name) ON DELETE CASCADE,
                date DATE NOT NULL,
                new_cards_today INTEGER DEFAULT 0,
                PRIMARY KEY (profile_name, date)
            )
        `);

        // Insert sample data for the 'cat' profile if it doesn't exist
        const profileCheck = await client.query('SELECT * FROM profiles WHERE profile_name = $1', ['cat']);
        if (profileCheck.rowCount === 0) {
            // Insert cat profile
            await client.query(
                'INSERT INTO profiles (profile_name, selected_words) VALUES ($1, $2)',
                ['cat', ['charge', 'run']]
            );

            // Insert sample flashcards
            await client.query(`
                INSERT INTO flashcards
                (profile_name, word_sense_id, word, definition, translation, part_of_speech, context, definition_number, example, in_flashcards)
                VALUES
                ('cat', 'charge24', 'charge', 'energize a battery by passing a current through it', 'cargar', 'verb', 'I need to charge my phone', 24, 'Remember to charge your devices overnight', true),
                ('cat', 'run1', 'run', 'move at a speed faster than a walk', 'correr', 'verb', 'She likes to run in the park', 1, 'He runs every morning to stay fit', true)
                ON CONFLICT (profile_name, word_sense_id) DO NOTHING
            `);
        }

        console.log('[Database] Initialization completed successfully');
        // Test database connection explicitly after initialization
        return pool.connect();
    } catch (err) {
        console.error('[Database] Error initializing database:', err);
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    initializeDatabase
};
