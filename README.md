# Polycast - Real-Time Language Learning Platform

A comprehensive language learning application that combines real-time transcription, translation, and spaced repetition flashcards with AI-powered content generation.

## ⚠️ CRITICAL: Flashcard Format Reference
**ALWAYS check this section when working on flashcards - the format is very specific!**

**FRONT of Card:**
1. English sentence with target word blanked out: "I will _____ into battle"
2. Full translation with target word highlighted: "我将**冲锋**进入战斗"
3. "Click to reveal answer" hint

**BACK of Card:**
1. Full English sentence with target word highlighted: "I will **charge** into battle"
2. 🔊 Play Audio button for text-to-speech

**System Details:**
- Each word gets 5 sample sentences from Gemini with `~word~` markup
- SRS interval determines which sentence is shown (rotating through all 5)
- Cloze deletion format for active recall learning
- Target word highlighting in yellow on back, native language on front
- **CRITICAL**: All flashcards MUST have `exampleSentencesGenerated` field with proper `~word~` markup - no fallback UI exists

## 🚫 CRITICAL DEVELOPMENT RULES

### NO FALLBACK UI
**NEVER create fallback UI to paper over missing data or broken functionality!**

- **Always fix the root cause** instead of adding bandaid solutions
- **If data is missing, throw a clear error** instead of showing wrong format
- **No "basic" flashcard formats** - only the proper cloze deletion format
- **If the backend doesn't generate proper data, fix the backend** - don't work around it in frontend
- **Better to crash with a clear error** than to lie to the user with wrong functionality

This prevents technical debt and ensures we actually solve problems instead of hiding them.

### ALWAYS UPDATE README
**EVERY TIME you make changes, update this README with important information for the next AI!**

- **Document UI changes** - new components, button layouts, mode switches
- **Document backend changes** - API endpoints, data formats, validation rules
- **Document bug fixes** - what was broken and how it was fixed
- **Document development patterns** - coding standards, architectural decisions
- **Update system requirements** - new dependencies, environment variables

This ensures continuity and prevents future AIs from repeating mistakes or missing context.

## 📝 RECENT MAJOR CHANGES

### UI Mode Switching (December 2024)
- **Replaced mode dropdown with emoji buttons** in `/polycast-frontend/src/components/Controls.jsx`
- **Button layout**: 📝 Transcript (students in rooms only), 📚 Dictionary, 🔄 Flashcard
- **Smart visibility**: Only show buttons for modes you're NOT currently in
- **Transcript button logic**: Only appears for students when actually in a room (requires `roomSetup` prop)
- **Location**: Top controls bar, next to profile selector

### Backend Flashcard Generation (December 2024)
- **Fixed Gemini preamble issue**: Added cleanup patterns to strip "Here's the output:" from responses
- **Enhanced validation**: Backend now validates proper `~word~` markup and throws clear errors
- **Improved Gemini prompt**: More explicit structure requiring exactly 12 parts with concrete example
- **Better error logging**: Detailed logging of failed responses for debugging
- **Location**: `/polycast-backend/server.js` lines 915-975

### Flashcard Error Handling (December 2024)
- **Removed all fallback UI** that showed basic word format instead of proper cloze deletion
- **Clear error throwing**: Components now fail clearly when `exampleSentencesGenerated` is missing
- **Fixed session completion logic**: Only shows completion screen after reviewing cards, not when starting empty
- **Improved no-cards message**: Clear numbered instructions on how to add words via Dictionary Mode and transcript clicking
- **Localized instructions**: No-cards message now displays in user's native language (Chinese, Spanish, French, German, Italian, Portuguese)
- **Affected files**: `FlashcardMode.jsx`, `MobileFlashcardMode.jsx`, `useFlashcardSession.js`

## 🎯 Overview

Polycast is a full-stack language learning platform designed for immersive learning experiences. It features real-time audio/video processing with AI transcription, intelligent flashcard generation using spaced repetition algorithms, and mobile-optimized study sessions.

## 🏗️ Architecture

### Frontend (`polycast-frontend`)
- **Framework**: React 18 + Vite
- **Deployment**: Netlify
- **Key Features**:
  - Responsive desktop and mobile interfaces
  - Real-time WebSocket communication
  - Touch gesture support for mobile flashcards
  - Audio recording and playback
  - Progressive Web App capabilities

### Backend (`polycast-backend`)
- **Framework**: Node.js + Express
- **Deployment**: Render
- **Key Services**:
  - WebSocket server for real-time communication
  - Audio processing with OpenAI Whisper
  - Text-to-speech with OpenAI TTS
  - Redis for session management
  - PostgreSQL for user data persistence

## 🔧 Core Features

### 1. Real-Time Transcription & Translation
- **Audio Mode**: Live audio recording with real-time transcription
- **Video Mode**: Screen sharing with synchronized transcription
- **Multi-language Support**: Automatic language detection and translation
- **Services**: OpenAI Whisper (transcription), DeepL (translation)

### 2. Intelligent Dictionary System
- **Comprehensive Database**: 26 JSON files (a-z.json) containing detailed word definitions
- **AI Enhancement**: Gemini API provides frequency ratings (1-10 scale) and example sentences
- **Smart Lookup**: Clickable words in transcriptions with instant definitions
- **Definition Sources**: Primary dictionary JSON, fallback to AI generation

### 3. Spaced Repetition System (SRS)
- **Algorithm**: Customized SRS with 9 interval levels
- **Card Types**: New cards, learning cards, review cards
- **Frequency-Based Sorting**: New cards sorted by word frequency (10 = most common)
- **Due Date Management**: Automatic scheduling based on performance
- **Session Limits**: Configurable daily new card limits

### 4. Flashcard System (Cloze Deletion Format)
- **Card Front**: English sentence with target word blanked out (e.g., "I will _____ into battle") + full translation with target word highlighted in native language
- **Card Back**: Full English sentence with target word highlighted in yellow + text-to-speech audio
- **Generated Content**: Each word gets 5 example sentences from Gemini API with ~word~ markup
- **Rotation System**: SRS interval determines which of the 5 sentences is shown
- **Touch Gestures** (Mobile): Swipe left (wrong), swipe right (correct), tap to flip
- **Visual Feedback**: Color-coded responses, smooth animations
- **Audio Integration**: Text-to-speech playback for pronunciation practice
- **Progress Tracking**: Session statistics and learning analytics

### 5. Profile Management
- **Multiple Profiles**: Cat, Dog, Mouse, Horse, Lizard + Non-saving mode
- **Data Persistence**: Individual progress tracking per profile
- **Cloud Sync**: Automatic backup of flashcard progress
- **Non-saving Mode**: Temporary sessions with hardcoded cards for testing

## 📁 Project Structure

```
polycast-main/
├── polycast-frontend/
│   ├── src/
│   │   ├── components/          # Desktop React components
│   │   ├── mobile/             # Mobile-specific components
│   │   │   ├── components/     # Mobile flashcard interface
│   │   │   ├── styles/         # Mobile CSS
│   │   │   └── utils/          # Touch gesture handlers
│   │   ├── utils/              # SRS algorithm, card sorting
│   │   └── hooks/              # Error handling, state management
│   └── public/                 # Static assets
└── polycast-backend/
    ├── services/               # Core business logic
    │   ├── whisperService.js   # Audio transcription
    │   ├── llmService.js       # AI text processing
    │   ├── redisService.js     # Session management
    ├── dictionary-data/        # Word definition JSON files
    └── config/                 # Environment configuration
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Redis server
- PostgreSQL database
- API keys: OpenAI, DeepL, Google Gemini

### Frontend Setup
```bash
cd polycast-frontend
npm install
npm run dev
```

### Backend Setup
```bash
cd polycast-backend
npm install

# Create .env file
OPENAI_API_KEY=your_openai_key
DEEPL_API_KEY=your_deepl_key
GEMINI_API_KEY=your_gemini_key
REDIS_URL=your_redis_url
DATABASE_URL=your_postgres_url

npm start
```

## 🎮 Usage

### Desktop Mode
1. Select language pair and room
2. Choose audio or video mode
3. Start recording/streaming
4. Click transcribed words for definitions
5. Add words to flashcards for later study

### Mobile Mode
1. Select study profile
2. Start flashcard session
3. Use gestures: tap to flip, swipe for answers
4. Audio playback available for pronunciation
5. Track progress with session statistics

## 🔄 SRS Algorithm Details

### Card States
- **New**: Never studied (frequency-sorted, 10 = highest priority)
- **Learning**: Short intervals (1-10 minutes)
- **Review**: Long intervals (days to months)

### Intervals
- Level 1: 1 minute
- Level 2: 5 minutes
- Level 3: 20 minutes
- Level 4: 1 hour
- Level 5: 4 hours
- Level 6: 1 day
- Level 7: 3 days
- Level 8: 1 week
- Level 9: 2+ weeks

### Frequency Integration
- New cards sorted by Gemini frequency ratings
- Higher frequency = earlier introduction
- Ensures common words are learned first

## 🎨 Mobile Interface Features

### Touch Gestures
- **Single Tap**: Flip card to show answer
- **Swipe Right**: Mark correct (green feedback)
- **Swipe Left**: Mark incorrect (red feedback)
- **Long Press**: Access quick actions menu

### Visual Feedback
- Color-coded swipe indicators
- Smooth card transitions
- Progress indicators
- Session statistics display

## 📊 Data Flow

### Word Addition Process
1. User clicks word in transcription
2. Dictionary JSON lookup for definition
3. Gemini API call for frequency + examples
4. Card creation with SRS data structure
5. Addition to user's flashcard deck

### Study Session Flow
1. Load due cards (past due date)
2. Load new cards (frequency-sorted)
3. Present cards with daily limits
4. Update SRS data based on responses
5. Calculate next review dates
6. Save progress to database

## 🔧 Configuration

### SRS Settings
- `newCardsPerDay`: Daily limit for new cards (default: 5)
- `maxCardsPerSession`: Total session limit (default: 50)
- `audioAutoplay`: Automatic pronunciation (default: true)

### Environment Variables
- `OPENAI_API_KEY`: Required for Whisper & TTS
- `DEEPL_API_KEY`: Required for translation
- `GEMINI_API_KEY`: Required for frequency analysis
- `REDIS_URL`: Session storage
- `DATABASE_URL`: User data persistence

## 🚀 Deployment

### Frontend (Netlify)
- Automatic deployment from Git
- Build command: `npm run build`
- Publish directory: `dist`
- Redirects configured for SPA routing

### Backend (Render)
- Node.js service deployment
- Environment variables configured
- WebSocket support enabled
- Redis and PostgreSQL addons

## 🧪 Testing

### Hardcoded Cards (Non-saving Mode)
- 10 new cards with frequencies 6-10
- 6 review cards with various due dates
- Perfect for testing SRS algorithm
- No database persistence required

### Debug Features
- Array export functionality
- Console logging for SRS calculations
- Card order preview buttons
- Development mode indicators

## 📱 Mobile Optimization

### Performance
- Optimized touch event handling
- Reduced animations for smoother experience
- Efficient card loading and caching
- Background audio processing

### UX Design
- Large touch targets for accessibility
- Clear visual feedback for all actions
- Intuitive gesture-based interface
- Responsive design for all screen sizes

## 🤝 Contributing

### Code Structure
- Follow existing naming conventions
- Use functional React components with hooks
- Implement proper error handling
- Add console logging for debugging
- **ALWAYS push changes to git after completing tasks**

### SRS Integration
- Always use `frequency` field for card sorting
- Maintain SRS data structure consistency
- Update due dates after each review
- Handle edge cases for new vs. review cards

---

*Polycast combines the power of real-time AI processing with proven spaced repetition techniques to create an immersive language learning experience optimized for both desktop and mobile use.*
