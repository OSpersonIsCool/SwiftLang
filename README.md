SwiftLang 
SwiftLang is a full-stack Japanese learning extension for Chrome. It turns every Japanese word on the web into a clickable dictionary lookup, saves vocabulary to a local spaced-repetition system (FSRS), and lets you practice conversation with an AI partner voiced by Konata Izumi. No servers, no accounts, no data leaves your browser.

Features
Click-Anywhere Word Lookup
A content script tokenizes Japanese text on any webpage (powered by a bundled TinySegmenter) and wraps it in clickable spans.

Clicking a word opens a sentence-aware popup in a closed Shadow DOM, so page CSS can't break it.

Lookups use a Yomitan-style smart matcher against the Jisho API: it tries the clicked token, honorific stems (茸さん), 2–3 token compounds, honorific prefixes (お/ご), and inflected forms (食べられなかった → 食べる) before falling back to fuzzy results.

Every popup shows: furigana, pitch-accent graph, JLPT/WaniKani tags, frequency rank, kanji breakdown (KANJIDIC2 via kanjiapi.dev), example sentences (Tatoeba), and a machine translation of the surrounding sentence.

AI Context (Optional)
With a Gemini API key, the popup asks the model what the word means in this sentence — disambiguating senses, spotting names, and fixing readings.

Gracefully degrades to MyMemory translation + local heuristics when no key is present.

All AI requests go through the background service worker; the key never touches page scripts.

Pronunciation
Recorded native audio from JapanesePod101 is tried first for single words (with hash validation to reject their "no audio" clip); TTS is the fallback.

Words are always spoken from their kana reading, so the voice engine never mis-reads a kanji.

Sentences are spoken via TTS with the clicked word swapped for its reading.

Voice scoring prefers neural/enhanced/Google voices; playback rate and pitch are tuned for a crisp, lively tone.

FSRS Spaced Repetition
Cards are saved locally (chrome.storage.local) with the full context: word, reading, sentence, translation, pitch, frequency, kanji, examples, and source URL.

Scheduling uses FSRS v4.5 with four ratings (Again / Hard / Good / Easy) and per-card stability/difficulty/retrievability.

The study page supports keyboard shortcuts (Space to flip, 1–4 to rate, V/S for audio, I to swap the picture), light/dark/auto themes, custom fonts, accent colors, background images, and adjustable word/reading sizes.

Card Pictures
A wholesome anime reaction GIF (nekos.best, with waifu.pics as back-up) is chosen from the card's English glosses via a conservative rule set in core.js.

Names, grammar words, and heavy topics get no picture at all; words that don't clearly match get a calm neutral GIF instead of a forced fit.

Pictures load off-screen while you think, so they're ready when you flip. You can swap one (🔄) or permanently block it (🚫).

AI Conversation Partner (Konata)
A chat page where Konata Izumi (Lucky Star) teaches Japanese with full otaku personality: lazy, sarcastic, gaming-obsessed, and constantly referencing anime.

Detects your JLPT level from your messages (N5 → N1) and adapts vocabulary and grammar complexity accordingly.

Responses are strictly {japanese, romaji} JSON so the chat stays clean.

Speech recognition (hold Q or click the mic) with silence auto-send, a real-time playback speed bar (0.5×–2×), and a mascot with six emotions.

Export
One-click CSV export to Anki (Front: word + reading; Back: meanings + sentence + translation; Tags: JLPT/common).

Architecture
text
manifest.json          MV3 manifest
background.js          Service worker: all network calls (Jisho, Gemini, Tatoeba,
                       kanjiapi, pitch/frequency datasets, audio, pictures)
core.js                Pure, DOM-free helpers (furigana alignment, conjugation,
                       inflection matching, name detection, sense ranking, AI
                       prompt building, picture planning) — unit-testable in Node
content.js             Tokenizes Japanese text, renders the closed-Shadow-DOM popup
audio.js               TTS + native-audio playback (shared by popup and flashcards)
tiny_segmenter.js      Bundled Japanese tokenizer
fsrs.js                FSRS v4.5 scheduler
popup.html/js          Toolbar popup: due/new/total stats, study/browse/export
srs.html/js            Study & browse interface
chatbot.html/js        Konata AI conversation partner
The extension is layered so that core.js has zero DOM or chrome.* dependencies, and background.js is the only place that talks to the network. Content scripts and pages communicate with it exclusively via chrome.runtime.sendMessage.

Data Sources
Source	Used for	Licence / Note
Jisho.org (JMdict)	Dictionary entries	EDRDG licence
MyMemory	Sentence translation (fallback)	Free tier
Google Gemini (gemini-2.5-flash-lite)	AI context & chat	User-supplied key
kanjiapi.dev (KANJIDIC2)	Kanji breakdown	—
Tatoeba	Example sentences	CC BY 2.0 FR
Kanjium	Pitch accent & frequency lists	One-time background download
JapanesePod101	Native word audio	Public assets
nekos.best / waifu.pics	Flashcard reaction GIFs	Wholesome categories only
Pitch-accent and frequency datasets (Kanjium) are downloaded once in the background, bucketed into 128 shards, and cached in chrome.storage.local.


Keyboard Shortcuts
Context	Key	Action
Any page	Esc	Close the word popup
Study	Space	Show answer
Study	1 / 2 / 3 / 4	Rate Again / Hard / Good / Easy
Study	V	Play word
Study	S	Play sentence
Study	I	Swap card picture
Chat	Hold Q	Record speech (release to send)
🛠️ Technical Notes
Furigana alignment uses a backtracking solver that matches kana runs against the reading, so kanji compounds get correct ruby even with mixed kana.

Conjugation covers godan/ichidan/suru/kuru verbs and i-adjectives, including polite, negative, te-form, conditional, potential, passive, causative, desiderative, and compound auxiliaries (-te iru, -te shimau, -te oku, etc.).

Inflection matching lets the popup recognize 食べられなかった as a form of 食べる without extra network requests.

Pitch-accent rendering draws mora-by-mora overlines and drop hooks from Kanjium's NHK/Wadoku/Daijirin data.

Popup positioning measures natural height and flips above/below the clicked token, scrolling internally rather than covering the word.

Audio is decoded through the Web Audio API when available (for gapless native playback) with an <audio> fallback; prime() must run synchronously in the click handler for autoplay policies.

All enrichment is optional and failure-tolerant: if any source is down, its section is simply omitted.

Licence
The bundled tiny_segmenter.js is © 2008 Taku Kudo, distributed under a new BSD licence. Dictionary data is provided by JMdict (EDRDG), KANJIDIC2, Tatoeba (CC BY 2.0 FR), and Kanjium. Gemini and Jisho are used under their respective terms.
