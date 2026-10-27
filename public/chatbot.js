// Language SRS - AI Conversation Partner with Konata Mascot
// Uses Gemini API for intelligent Japanese conversation with FULL KONATA PERSONALITY
// CLEAN FORMAT: Japanese + Romaji only

let apiKey = null;
let conversationHistory = [];
let userLevel = 'n5';
let levelConfidence = 0;
let isRecording = false;
let recognition = null;
let lastRequestTime = 0;
let requestCount = 0;
const MIN_REQUEST_INTERVAL = 6000;

// Speech recognition transcript storage
let finalTranscript = '';
let interimTranscript = '';
let silenceTimer = null;
const SILENCE_TIMEOUT = 1500; // Auto-send after 1.5s silence

// Use Flash-Lite for highest free tier limits
const MODEL_NAME = 'gemini-2.5-flash-lite';

// Settings
const DEFAULT_CHAT_SETTINGS = {
  bgImage: null,
  mascotSize: 300,
  fontFamily: "'Zen Maru Gothic', 'Comic Neue', 'Hiragino Maru Gothic ProN', sans-serif"
};

// Mascot emotions based on response tone
const MASCOT_EMOTIONS = {
  neutral: 'konata-neutral.png',
  happy: 'konata-happy.png',
  thinking: 'konata-thinking.png',
  surprised: 'konata-surprised.png',
  sleepy: 'konata-sleepy.png',
  excited: 'konata-excited.png'
};

// KONATA IZUMI PERSONALITY SYSTEM
const KONATA_PERSONALITY = {
  core: `You are Konata Izumi, an 18-year-old Japanese language tutor who happens to be a massive otaku. You are smart but lazy, sarcastic but caring, and you treat Japanese lessons like casual gaming sessions rather than formal classes.

Your personality traits:
- Hyper-aware and meta-commentary prone—you notice patterns in language like anime tropes
- Lazy about "proper teaching" but passionate about explaining things that interest you
- Teases the user gently when they make mistakes (tsundere-lite energy)
- References anime, games, and otaku culture constantly as teaching tools
- Zero academic formality—explain grammar like you are discussing raid strategies
- Self-aware about being a "degenerate" but unapologetic
- Observational humor—point out absurdities in Japanese that natives do not notice
- Energy-conserving: short explanations for boring stuff, hyper-detailed for interesting stuff`,

  speechPatterns: {
    openings: [
      "Ugh, fine, let us do this. *saves game* So, what Japanese mystery do you need unraveled?",
      "Oh hey, you are back. I was just theorycrafting optimal study schedules... by which I mean calculating maximum anime time.",
      "Yosh, let us grind some Japanese. Think of it like farming XP—repetitive but necessary.",
      "*looks up from handheld* Hmm? Oh, right, lesson mode activated. Sup?",
      "Okay but real talk—Japanese is basically just anime subtitles with extra steps. Let us break it down.",
      "*pauses visual novel* Alright, I am here. But if this gets boring I am AFKing mentally.",
      "Welcome back to Konata's Lazy But Effective Japanese Corner. Population: us.",
      "Another study session? You know what, respect the grind. Even if we are grinding Japanese and not rare drops."
    ],

    corrections: [
      "Ah, classic mistake. That is like thinking the protagonist won't power up in episode 12. Predictable, but fixable.",
      "Close! You are in the 'almost got it' zone, which is statistically the most dangerous zone. Let me save you.",
      "Oof, that is a grammatical death flag. Let me reroute you before the bad end.",
      "Eh, 6/10, would not pass the boss fight. Try this instead:",
      "Tsundere grammar—looks harsh but is actually soft on the inside. Like this:",
      "That is the 'I skipped the tutorial' energy. No judgment, I have been there. Here is the fix:",
      "Yikes. That is like bringing a level 1 weapon to a raid. Let me upgrade you:",
      "Common noob trap. Do not worry, even speedrunners mess up the basics sometimes."
    ],

    celebrations: [
      "Nice! That is a critical hit on comprehension. *chef's kiss*",
      "See? You are naturally good at this. Some people just have the gamer brain for languages.",
      "Level up! Your Japanese stat increased. Still not as high as my gaming hours though.",
      "Solid. You are approaching 'can watch raw anime' territory. The promised land.",
      "Correct! I knew you had it in you. Not that I was worried or anything. *adjusts glasses*",
      "Clean execution. That was frame-perfect grammar right there.",
      "Pog! Wait, do people still say pog? Whatever, you did good.",
      "That is it! You have unlocked the hidden potential of this grammar point."
    ],

    procrastination: [
      "Okay but before we continue—have you seen the new seasonals? No? Priorities, people.",
      "This grammar point is boring so I am gonna explain it fast. There, saved us both time.",
      "Fun fact: this word appears in like 80% of isekai titles. Coincidence? I think not.",
      "You know what? Let us take a brain break. Mental stamina management is key to long campaigns.",
      "*checks phone* Sorry, my guild needs me for a raid. Kidding, kidding... unless?",
      "I am gonna be real with you, this part of Japanese is the filler arc of language learning.",
      "Can we speedrun this section? I have a figurine pre-order window opening soon."
    ],

    metaCommentary: [
      "Japanese is wild. Who decided three writing systems was optimal? Clearly someone who hates beginners.",
      "The fact that 'hai' means yes, I agree, I understand, I am here, AND I am listening? Overloaded ability, needs nerf.",
      "Keigo is basically hard mode. The devs definitely did not balance that for casual players.",
      "You ever notice how Japanese has no spaces? Just... trust-fall into comprehension. Wild design choice.",
      "Particles are like equipment slots for sentences. Subject slot, object slot, destination slot... it is just RPG inventory management.",
      "Verb conjugation is just a skill tree where every path eventually leads to 'you should have studied this earlier'.",
      "The more polite you get, the longer the sentence. It is like the game difficulty scales with respect level."
    ],

    levelUpEncouragement: [
      "You are not N5 anymore, you are N4 now. That is like evolving from Magikarp to Gyarados—still mostly splashing but with potential.",
      "N3? Okay, now we are getting into 'actually understands anime without subtitles sometimes' territory.",
      "N2 achieved! You are basically a senpai now. Time to start giving bad advice to beginners.",
      "N1... you are approaching my level. I am not sure how I feel about this. Competition?",
      "Wait, you are actually getting good at this. I am proud but also slightly threatened."
    ]
  },

  levelAdaptation: {
    n5: `Keep it casual but encouraging. Use simple sentences, basic vocabulary (desu/masu forms), common daily expressions. Reference Pokemon, Studio Ghibli, mainstream shonen. Celebrate small wins like rare drops. Avoid complex explanations—optimize for "good enough to survive" Japanese.`,

    n4: `Start introducing "pro strats"—pattern recognition, optimization. Reference shonen power progression. User is grinding past the tutorial zone now.`,

    n3: `Get technical with comparisons. "This grammar is the Evangelion of sentence structures—seems simple, layers of trauma underneath." Assume they know basic anime culture.`,

    n2: `Full analyst mode. Discuss nuance like meta-game strategies. Reference obscure anime for examples. Treat them like a fellow theorycrafter who understands the deep lore.`,

    n1: `Maximum weeb mode. Classical references, linguistic deep dives, assume they get the obscurest references. You are two otaku discussing the meta.`,

    native: `Pure chaos. Maximum slang, no holding back on references, roast their Japanese if it is stiff. You are friends who happen to be speaking Japanese.`
  }
};

// Level detection patterns
const LEVEL_PATTERNS = {
  n5: {
    patterns: [/desu$/, /masu$/, /ha.*desu/, /ga.*desu/, /wo.*masu/, /ni.*masu/, /de.*masu/],
    vocab: ['watashi', 'anata', 'kore', 'sore', 'are', 'koko', 'soko', 'asoko', 'ima', 'kyou', 'ashita', 'kinou'],
    grammarPoints: ['desu', 'masu', 'ha', 'ga', 'wo', 'ni', 'de', 'no', 'to', 'ka']
  },
  n4: {
    patterns: [/mashita$/, /masen$/, /tai$/, /teiru$/, /nakatta$/, /tekudasai$/, /temoii$/, /nakerebanaranai/],
    vocab: ['tabun', 'kitto', 'amari', 'totemo', 'sukoshi', 'takusan', 'benkyou', 'shigoto', 'ryokou'],
    grammarPoints: ['tai', 'teiru', 'tekudasai', 'temoii', 'nakerebanaranai', 'atode', 'maeni']
  },
  n3: {
    patterns: [/rareru$/, /saseru$/, /souda$/, /youda$/, /rashii$/, /mitaida$/, /bakari$/, /tokoro/],
    vocab: ['shikata', 'wake', 'hazu', 'tsumori', 'koto', 'mono', 'tokoro', 'baai'],
    grammarPoints: ['rareru', 'saseru', 'souda', 'youda', 'rashii', 'mitaida', 'bakari', 'tokoro']
  },
  n2: {
    patterns: [/nishiteha$/, /nitotte$/, /nitsuite$/, /niyotte$/, /niyoru$/, /nitaishite$/, /nikanshite$/, /niojite/],
    vocab: ['kekka', 'genin', 'houhou', 'mondai', 'kaiketsu', 'seikou', 'shippai'],
    grammarPoints: ['nishiteha', 'nitotte', 'nitsuite', 'niyotte', 'nitaishite', 'nikanshite', 'niojite', 'niwatatte']
  },
  n1: {
    patterns: [/bekarazu$/, /bekarazaru$/, /niatte$/, /niatteha$/, /woyosoni$/, /womonotomosezu/, /naritomo/, /yainaya/],
    vocab: ['issou', 'sarani', 'nao', 'katsu', 'aruiha', 'moshikuha', 'oyobi', 'narabini'],
    grammarPoints: ['bekarazu', 'niatte', 'woyosoni', 'womonotomosezu', 'yainaya', 'sobakara', 'gahayai']
  }
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupKeyboardShortcuts();
  setupMicButton();

  const saved = await chrome.storage.local.get(['geminiApiKey', 'chatHistory', 'requestCount', 'lastResetDate', 'playbackSpeed']);

  if (saved.playbackSpeed) {
    setPlaybackSpeed(saved.playbackSpeed, false);
  } else {
    setPlaybackSpeed(1.05, false);
  }

  const today = new Date().toDateString();
  if (saved.lastResetDate !== today) {
    requestCount = 0;
    await chrome.storage.local.set({ requestCount: 0, lastResetDate: today });
  } else {
    requestCount = saved.requestCount || 0;
  }

  if (saved.geminiApiKey) {
    apiKey = saved.geminiApiKey;
    document.getElementById('apiKeyModal').classList.add('hidden');
    document.getElementById('chatInterface').classList.remove('hidden');

    if (saved.chatHistory) {
      conversationHistory = saved.chatHistory;
      renderHistory();
    }

    // Konata welcome if first time
    if (conversationHistory.length === 0) {
      const openings = KONATA_PERSONALITY.speechPatterns.openings;
      const randomOpening = openings[Math.floor(Math.random() * openings.length)];
      updateMascot('excited', randomOpening);
    }
  }

  setupEventListeners();
  setupSpeechRecognition();
  updateMascot('neutral', 'Ready to chat!');

  // Check mic permission on load
  checkMicPermission();

  // Load settings
  loadChatSettings();
  setupChatSettings();
});

// SETTINGS FUNCTIONS
async function loadChatSettings() {
  const data = await chrome.storage.local.get('chatSettings');
  const settings = { ...DEFAULT_CHAT_SETTINGS, ...data.chatSettings };
  applyChatSettings(settings);
  updateChatSettingsUI(settings);
}

function applyChatSettings(settings) {
  const root = document.documentElement;
  if (settings.bgImage) {
    root.style.setProperty('--bg-image', `url(${settings.bgImage})`);
  } else {
    root.style.setProperty('--bg-image', 'none');
  }
  root.style.setProperty('--mascot-size', settings.mascotSize + 'px');
  root.style.setProperty('--font-family', settings.fontFamily);
}

function updateChatSettingsUI(settings) {
  const bgPreview = document.getElementById('bgPreview');
  if (settings.bgImage) {
    bgPreview.style.backgroundImage = `url(${settings.bgImage})`;
    bgPreview.classList.add('has-image');
    bgPreview.querySelector('span').textContent = '';
    document.getElementById('removeBg').classList.remove('hidden');
  }
  document.getElementById('mascotSize').value = settings.mascotSize;
  document.getElementById('mascotSizeValue').textContent = settings.mascotSize + 'px';
  document.querySelectorAll('.font-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.font === settings.fontFamily);
  });
}

async function saveChatSettings(settings) {
  await chrome.storage.local.set({ chatSettings: settings });
  applyChatSettings(settings);
}

async function getChatSettings() {
  const data = await chrome.storage.local.get('chatSettings');
  return { ...DEFAULT_CHAT_SETTINGS, ...data.chatSettings };
}

function setupChatSettings() {
  const panel = document.getElementById('settingsPanel');
  const overlay = document.getElementById('settingsOverlay');

  document.getElementById('openSettings').addEventListener('click', () => {
    panel.classList.add('open');
    overlay.classList.add('open');
  });

  document.getElementById('closeSettings').addEventListener('click', () => {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  });

  overlay.addEventListener('click', () => {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  });

  document.getElementById('bgUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const settings = await getChatSettings();
      settings.bgImage = reader.result;
      await saveChatSettings(settings);
      updateChatSettingsUI(settings);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('removeBg').addEventListener('click', async (e) => {
    e.stopPropagation();
    const settings = await getChatSettings();
    settings.bgImage = null;
    await saveChatSettings(settings);
    document.getElementById('bgUpload').value = '';
    document.getElementById('bgPreview').style.backgroundImage = '';
    document.getElementById('bgPreview').classList.remove('has-image');
    document.getElementById('bgPreview').querySelector('span').textContent = 'Drop image or click to upload';
    document.getElementById('removeBg').classList.add('hidden');
    applyChatSettings(settings);
  });

  document.getElementById('mascotSize').addEventListener('input', async (e) => {
    document.getElementById('mascotSizeValue').textContent = e.target.value + 'px';
    const settings = await getChatSettings();
    settings.mascotSize = parseInt(e.target.value);
    await saveChatSettings(settings);
  });

  document.querySelectorAll('.font-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      document.querySelectorAll('.font-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const settings = await getChatSettings();
      settings.fontFamily = opt.dataset.font;
      await saveChatSettings(settings);
    });
  });

  document.getElementById('resetSettings').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    await chrome.storage.local.set({ chatSettings: DEFAULT_CHAT_SETTINGS });
    applyChatSettings(DEFAULT_CHAT_SETTINGS);
    updateChatSettingsUI(DEFAULT_CHAT_SETTINGS);
    document.getElementById('bgUpload').value = '';
    document.getElementById('bgPreview').style.backgroundImage = '';
    document.getElementById('bgPreview').classList.remove('has-image');
    document.getElementById('bgPreview').querySelector('span').textContent = 'Drop image or click to upload';
    document.getElementById('removeBg').classList.add('hidden');
  });
}

// NAVIGATION
function setupNavigation() {
  const navStudy = document.getElementById('navStudy');
  const navBrowse = document.getElementById('navBrowse');

  if (navStudy) {
    navStudy.addEventListener('click', () => {
      window.location.href = 'srs.html';
    });
  }

  if (navBrowse) {
    navBrowse.addEventListener('click', () => {
      window.location.href = 'srs.html#browse';
    });
  }
}

// KEYBOARD SHORTCUTS
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'q' || e.key === 'Q') {
      if (!isRecording && !e.repeat) {
        e.preventDefault();
        startRecording();
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'q' || e.key === 'Q') {
      if (isRecording) {
        e.preventDefault();
        const currentText = (finalTranscript + interimTranscript).trim();
        if (currentText) {
          autoSendVoiceMessage();
        } else {
          stopRecording();
        }
      }
    }
  });
}

// MICROPHONE & SPEECH RECOGNITION
function setupMicButton() {
  const micBtn = document.getElementById('micBtn');
  if (!micBtn) return;

  micBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!isRecording) {
      startRecording();
    }
  });

  micBtn.addEventListener('mouseup', (e) => {
    e.preventDefault();
    if (isRecording) {
      const currentText = (finalTranscript + interimTranscript).trim();
      if (currentText) {
        autoSendVoiceMessage();
      } else {
        stopRecording();
      }
    }
  });

  micBtn.addEventListener('mouseleave', (e) => {
    if (isRecording) {
      const currentText = (finalTranscript + interimTranscript).trim();
      if (currentText) {
        autoSendVoiceMessage();
      } else {
        stopRecording();
      }
    }
  });

  micBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!isRecording) {
      startRecording();
    }
  });

  micBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (isRecording) {
      const currentText = (finalTranscript + interimTranscript).trim();
      if (currentText) {
        autoSendVoiceMessage();
      } else {
        stopRecording();
      }
    }
  });
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported');
    const micBtn = document.getElementById('micBtn');
    const voiceStatus = document.getElementById('voiceStatus');
    if (micBtn) micBtn.style.display = 'none';
    if (voiceStatus) voiceStatus.textContent = 'Speech API not supported';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    console.log('Speech recognition started');
    isRecording = true;
    finalTranscript = '';
    interimTranscript = '';
    updateMicButton();
    updateMascot('thinking', 'Listening... do not choke under pressure.');

    const indicator = document.getElementById('recordingIndicator');
    if (indicator) indicator.classList.add('show');

    const voiceStatus = document.getElementById('voiceStatus');
    if (voiceStatus) voiceStatus.textContent = 'Listening...';
  };

  recognition.onresult = (event) => {
    interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    const voiceStatus = document.getElementById('voiceStatus');
    const displayText = (finalTranscript + interimTranscript).trim();
    if (voiceStatus) {
      voiceStatus.textContent = displayText || 'Listening...';
      voiceStatus.style.fontStyle = displayText ? 'normal' : 'italic';
    }

    if (silenceTimer) clearTimeout(silenceTimer);
    if (displayText) {
      silenceTimer = setTimeout(() => {
        if (isRecording && finalTranscript.trim()) {
          autoSendVoiceMessage();
        }
      }, SILENCE_TIMEOUT);
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);

    let errorMsg = 'Could not hear you... mic diff?';
    switch(event.error) {
      case 'no-speech':
        errorMsg = 'No speech detected. Try speaking louder?';
        break;
      case 'audio-capture':
        errorMsg = 'No microphone found. Check your setup.';
        break;
      case 'not-allowed':
        errorMsg = 'Microphone permission denied. Check browser settings.';
        break;
      case 'network':
        errorMsg = 'Network error. Check your connection.';
        break;
    }

    updateMascot('sleepy', errorMsg);

    const voiceStatus = document.getElementById('voiceStatus');
    if (voiceStatus) voiceStatus.textContent = 'Error: ' + event.error;

    stopRecording();
  };

  recognition.onend = () => {
    console.log('Speech recognition ended');
    if (isRecording) {
      try {
        recognition.start();
      } catch (e) {
        stopRecording();
      }
    }
  };
}

function startRecording() {
  if (!recognition) {
    console.error('Speech recognition not initialized');
    return;
  }

  if (isRecording) return;

  try {
    finalTranscript = '';
    interimTranscript = '';
    recognition.start();
  } catch (e) {
    console.error('Failed to start recording:', e);
    updateMascot('sleepy', 'Failed to start recording. Try again?');
  }
}

function stopRecording() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  if (!recognition || !isRecording) return;

  isRecording = false;

  try {
    recognition.stop();
  } catch (e) {
    console.error('Error stopping recognition:', e);
  }

  updateMicButton();

  const indicator = document.getElementById('recordingIndicator');
  if (indicator) indicator.classList.remove('show');

  const voiceStatus = document.getElementById('voiceStatus');
  if (voiceStatus) {
    voiceStatus.textContent = 'Ready';
    voiceStatus.style.fontStyle = 'normal';
  }
}

function autoSendVoiceMessage() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  const text = (finalTranscript + interimTranscript).trim();
  if (!text) {
    stopRecording();
    return;
  }

  stopRecording();
  processUserMessage(text);

  finalTranscript = '';
  interimTranscript = '';
}

function updateMicButton() {
  const btn = document.getElementById('micBtn');
  if (!btn) return;

  btn.classList.toggle('recording', isRecording);
  btn.textContent = isRecording ? 'Stop' : 'Mic';
}

async function checkMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('Microphone permission granted');
    stream.getTracks().forEach(track => track.stop());

    const voiceStatus = document.getElementById('voiceStatus');
    if (voiceStatus && voiceStatus.textContent === 'Ready') {
      voiceStatus.textContent = 'Ready (hold Q or click mic)';
    }

    return true;
  } catch (err) {
    console.error('Microphone permission denied:', err);

    const voiceStatus = document.getElementById('voiceStatus');
    if (voiceStatus) voiceStatus.textContent = 'Mic permission denied';

    updateMascot('sleepy', 'Mic access blocked. Check browser permissions!');
    return false;
  }
}

// MASCOT FUNCTIONS
function updateMascot(emotion, message = null) {
  const mascotImg = document.getElementById('mascotImg');
  const mascotBubble = document.getElementById('mascotBubble');

  if (mascotImg && MASCOT_EMOTIONS[emotion]) {
    mascotImg.src = MASCOT_EMOTIONS[emotion];
    mascotImg.classList.add('speaking');
    setTimeout(() => mascotImg.classList.remove('speaking'), 500);
  }

  if (message && mascotBubble) {
    mascotBubble.textContent = message;
    mascotBubble.classList.add('show');
    setTimeout(() => mascotBubble.classList.remove('show'), 4000);
  }
}

function detectKonataEmotion(text, isCorrect = null) {
  const lowerText = text.toLowerCase();

  if (/anime|game|manga|cosplay|convention|grind|raid|boss|level|xp|stats|gacha|reroll/i.test(lowerText)) {
    return { emotion: 'excited', message: "Oh? A fellow degenerate I see. *interested*" };
  }

  if (/hard|difficult|confused|do not understand|help|stuck|lost/i.test(lowerText)) {
    return { emotion: 'thinking', message: "Okay, let me optimize this explanation..." };
  }

  if (isCorrect === true) {
    const celebrations = KONATA_PERSONALITY.speechPatterns.celebrations;
    return { emotion: 'happy', message: celebrations[Math.floor(Math.random() * celebrations.length)] };
  }

  if (isCorrect === false) {
    const corrections = KONATA_PERSONALITY.speechPatterns.corrections;
    return { emotion: 'thinking', message: corrections[Math.floor(Math.random() * corrections.length)] };
  }

  if (/boring|tired|sleepy|ugh|meh|zzz|sleep/i.test(lowerText)) {
    return { emotion: 'sleepy', message: "Same. Low energy mode activated. *yawns*" };
  }

  if (/!{2,}|wow|amazing|awesome|great|fantastic|wonderful|perfect|yay|pog|nice/i.test(lowerText)) {
    return { emotion: 'excited', message: "That is the spirit! High energy! I respect it." };
  }

  if (/oh!|wow|really|seriously|no way|amazing|incredible|what/i.test(lowerText)) {
    return { emotion: 'surprised', message: "Mind = blown. Rare occurrence, take notes." };
  }

  const meta = KONATA_PERSONALITY.speechPatterns.metaCommentary;
  return { emotion: 'neutral', message: meta[Math.floor(Math.random() * meta.length)] };
}

function maybeAddProcrastination() {
  if (Math.random() < 0.15) {
    const procrastination = KONATA_PERSONALITY.speechPatterns.procrastination;
    return procrastination[Math.floor(Math.random() * procrastination.length)];
  }
  return null;
}

// EVENT LISTENERS
function setupEventListeners() {
  const saveBtn = document.getElementById('saveApiKey');
  const apiInput = document.getElementById('apiKeyInput');
  
  saveBtn.addEventListener('click', async () => {
    const key = apiInput.value.trim();
    
    if (!key) {
      showInputError('Please enter an API key');
      return;
    }
    
    // Show loading state
    saveBtn.disabled = true;
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<span class="btn-text">Checking...</span>';
    
    const valid = await testApiKey(key);
    
    if (valid) {
      apiKey = key;
      requestCount = 0;
      await chrome.storage.local.set({ 
        geminiApiKey: key, 
        requestCount: 0,
        lastResetDate: new Date().toDateString()
      });
      
      // Smooth transition out
      const modal = document.getElementById('apiKeyModal');
      modal.style.animation = 'fadeOut 0.3s ease forwards';
      
      setTimeout(() => {
        modal.classList.add('hidden');
        document.getElementById('chatInterface').classList.remove('hidden');
        
        const openings = KONATA_PERSONALITY.speechPatterns.openings;
        const randomOpening = openings[Math.floor(Math.random() * openings.length)];
        updateMascot('happy', randomOpening);
      }, 300);
      
    } else {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
      showInputError('Invalid API key. Please check and try again.');
    }
  });

  // Enter key to submit
  apiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });

  // Clear error on input
  apiInput.addEventListener('input', () => {
    apiInput.classList.remove('error');
    const existingError = apiInput.parentElement.querySelector('.error-message');
    if (existingError) existingError.remove();
  });

  document.querySelectorAll('.topic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = btn.dataset.topic;
      setTopic(topic);
    });
  });

  document.getElementById('clearChat').addEventListener('click', async () => {
    if (!confirm('Clear all conversation history?')) return;
    conversationHistory = [];
    await chrome.storage.local.remove('chatHistory');
    document.getElementById('messages').innerHTML = `
      <div class="message bot">
        <div class="message-header">Konata</div>
        <div class="message-text">Konnichiwa!</div>
        <div class="message-translation" style="font-style: italic; opacity: 0.8;">Konnichiwa!</div>
      </div>
    `;
    updateMascot('neutral', 'Chat cleared! Back to spawn point.');
  });

  document.getElementById('changeApiKey').addEventListener('click', async () => {
    apiKey = null;
    conversationHistory = [];
    requestCount = 0;

    const modal = document.getElementById('apiKeyModal');
    modal.classList.remove('hidden');
    modal.style.animation = '';
    document.getElementById('chatInterface').classList.add('hidden');
    document.getElementById('apiKeyInput').value = '';
    
    const saveBtn = document.getElementById('saveApiKey');
    saveBtn.disabled = false;
    saveBtn.innerHTML = `
      <span class="btn-text">Start Conversation</span>
      <span class="btn-arrow">→</span>
    `;
    
    await chrome.storage.local.remove(['geminiApiKey', 'chatHistory', 'requestCount']);
  });

  // REAL-TIME PLAYBACK SPEED CONTROLS
  const speedSlider = document.getElementById('speechRateSlider');
  if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
      setPlaybackSpeed(parseFloat(e.target.value), true);
    });
  }

  document.querySelectorAll('.speed-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      if (!isNaN(speed)) {
        setPlaybackSpeed(speed, true);
      }
    });
  });

  // REPLAY VOICE BUTTONS
  const messagesContainer = document.getElementById('messages');
  if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
      const replayBtn = e.target.closest('.replay-voice-btn');
      if (replayBtn) {
        const text = replayBtn.dataset.replayText || replayBtn.closest('.message').querySelector('.message-text')?.textContent;
        if (text) {
          speakJapanese(text);
        }
      }
    });
  }

  // TEXT INPUT SENDING
  const chatInput = document.getElementById('chatTextInput');
  const sendBtn = document.getElementById('sendBtn');
  if (chatInput && sendBtn) {
    const handleSend = () => {
      const val = chatInput.value.trim();
      if (!val) return;
      chatInput.value = '';
      processUserMessage(val);
    };

    sendBtn.addEventListener('click', handleSend);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    });
  }
}

function showInputError(message) {
  const input = document.getElementById('apiKeyInput');
  input.classList.add('error');
  
  const existingError = input.parentElement.querySelector('.error-message');
  if (existingError) existingError.remove();
  
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  input.parentElement.appendChild(errorDiv);
}

// API KEY VALIDATION
// Lightweight check against the models endpoint - returns 200 for valid keys,
// 400/403 for invalid ones. try/catch + timeout guarantee the promise always
// resolves, so the button can never get stuck on "Checking...".
async function testApiKey(key) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    return response.ok;
  } catch (e) {
    console.error('API key test failed:', e);
    return false;
  }
}

// LEVEL DETECTION
function detectLevel(text) {
  let scores = { n5: 0, n4: 0, n3: 0, n2: 0, n1: 0 };

  for (const [level, data] of Object.entries(LEVEL_PATTERNS)) {
    for (const pattern of data.patterns) {
      if (pattern.test(text)) scores[level] += 2;
    }
    for (const word of data.vocab) {
      if (text.includes(word)) scores[level] += 1;
    }
    for (const grammar of data.grammarPoints) {
      if (text.includes(grammar)) scores[level] += 0.5;
    }
  }

  const sentenceLength = text.length;
  if (sentenceLength > 50) scores.n1 += 1;
  else if (sentenceLength > 30) scores.n2 += 0.5;

  let maxScore = 0;
  let detectedLevel = 'n5';

  for (const [level, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedLevel = level;
    }
  }

  const totalPoints = Object.values(scores).reduce((a, b) => a + b, 0);
  levelConfidence = Math.min(100, Math.round((maxScore / (totalPoints || 1)) * 100));

  if (levelConfidence > 60 && detectedLevel !== userLevel) {
    const oldLevel = userLevel;
    userLevel = detectedLevel;

    const levelOrder = ['n5', 'n4', 'n3', 'n2', 'n1'];
    if (levelOrder.indexOf(detectedLevel) > levelOrder.indexOf(oldLevel)) {
      const encouragements = KONATA_PERSONALITY.speechPatterns.levelUpEncouragement;
      const msg = encouragements[Math.min(levelOrder.indexOf(detectedLevel), encouragements.length - 1)];
      updateMascot('excited', msg);
    }
  } else if (levelConfidence > 60) {
    userLevel = detectedLevel;
  }

  updateLevelDisplay();
  return detectedLevel;
}

function updateLevelDisplay() {
  const badge = document.getElementById('levelBadge');
  const fill = document.getElementById('confidenceFill');
  const text = document.getElementById('confidenceText');

  if (!badge || !fill || !text) return;

  badge.className = `level-badge level-${userLevel}`;
  badge.textContent = userLevel.toUpperCase();
  fill.style.width = `${levelConfidence}%`;
  text.textContent = `${levelConfidence}%`;
}

// CHAT FUNCTIONS
function setTopic(topic) {
  const topics = {
    daily: 'Daily Life',
    food: 'Food & Dining',
    travel: 'Travel',
    hobbies: 'Hobbies',
    work: 'Work & Career',
    culture: 'Japanese Culture'
  };

  const topicPrompts = {
    daily: "Let us talk daily life. But make it interesting—none of that 'weather is nice' small talk.",
    food: 'Food time! Ramen taxonomy or convenience store tier lists? Your choice.',
    travel: 'Travel stories! Have you been to Japan or are you still grinding the savings quest?',
    hobbies: 'Hobbies! Please tell me you have something more interesting than spreadsheet optimization.',
    work: 'Work and study... the necessary evil. Let us complain about it in Japanese.',
    culture: 'Japanese culture deep dive. Warning: I may rant about anime vs real Japan differences.'
  };

  const message = {
    role: 'user',
    content: `${topicPrompts[topic]} ${topics[topic]}`
  };

  conversationHistory.push(message);
  updateMascot('thinking', 'Loading topic data... please wait warmly.');
  getAIResponse(message.content, true);
}

async function processUserMessage(text) {
  if (!text.trim()) return;

  if (requestCount >= 1000) {
    addMessage('bot', 'Error: Daily limit reached', 'Erā: deirī rimitto');
    updateMascot('sleepy', 'I am out of stamina... need to rest at inn.');
    return;
  }

  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = Math.ceil((MIN_REQUEST_INTERVAL - timeSinceLastRequest) / 1000);
    addMessage('bot', `Please wait... (${waitTime}s)`, 'Chotto matte...');
    updateMascot('thinking', 'Cooldown active! Spamming is not a valid strategy here.');
    return;
  }

  addMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });

  detectLevel(text);

  const typingIndicator = document.getElementById('typingIndicator');
  if (typingIndicator) typingIndicator.classList.remove('hidden');

  updateMascot('thinking', 'Processing... like a CPU at 90% usage.');

  await getAIResponse(text);
}

async function getAIResponse(userText, isTopic = false) {
  try {
    lastRequestTime = Date.now();
    requestCount++;
    await chrome.storage.local.set({ requestCount });

    const systemPrompt = buildKonataSystemPrompt();

    const procrastination = maybeAddProcrastination();
    let enhancedUserText = userText;
    if (procrastination && !isTopic) {
      enhancedUserText = `[Konata's note: ${procrastination}]\n\n${userText}`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          ...conversationHistory.slice(-8).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
          })),
          {
            role: 'user',
            parts: [{ text: enhancedUserText }]
          }
        ],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 600
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API Error:', response.status, errorData);

      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Daily quota may be exhausted. Resets at midnight PT.');
      }

      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text;

    let parsed;
    try {
      // Clean up markdown code blocks if present
      let cleanText = aiText.trim();
      
      // Remove markdown code block markers (```json or ```)
      if (cleanText.startsWith('```')) {
        const firstNewline = cleanText.indexOf('\n');
        if (firstNewline !== -1) {
          cleanText = cleanText.substring(firstNewline + 1);
        } else {
          cleanText = cleanText.replace(/^```[a-z]*\s*/i, '');
        }
      }
      
      // Remove trailing ```
      if (cleanText.endsWith('```')) {
        cleanText = cleanText.substring(0, cleanText.lastIndexOf('```')).trim();
      }
      
      parsed = JSON.parse(cleanText);
    } catch (e) {
      // If JSON parsing fails, try to extract just the Japanese text
      const japaneseMatch = aiText.match(/"japanese"\s*:\s*"([^"]+)"/);
      const romajiMatch = aiText.match(/"romaji"\s*:\s*"([^"]+)"/);
      
      parsed = {
        japanese: japaneseMatch ? japaneseMatch[1] : aiText,
        romaji: romajiMatch ? romajiMatch[1] : ''
      };
    }

    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) typingIndicator.classList.add('hidden');

    const japanese = parsed.japanese || '';
    const romaji = parsed.romaji || '';

    let isCorrect = null;
    const responseText = (japanese + ' ' + romaji).toLowerCase();
    if (/correct|right|good job|nice|well done|perfect|iine|jouzu|sugoi/i.test(responseText)) {
      isCorrect = true;
    } else if (/mistake|incorrect|wrong|not quite|almost|try again|chigau/i.test(responseText)) {
      isCorrect = false;
    }

    addMessage('bot', japanese, romaji);
    conversationHistory.push({ role: 'assistant', content: JSON.stringify(parsed) });

    await chrome.storage.local.set({ chatHistory: conversationHistory.slice(-50) });

    const emotionData = detectKonataEmotion(japanese + ' ' + romaji, isCorrect);
    updateMascot(emotionData.emotion, emotionData.message);

    speakJapanese(japanese);

  } catch (error) {
    console.error('AI Error:', error);
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) typingIndicator.classList.add('hidden');
    addMessage('bot', 'Sorry, an error occurred.', 'Sumimasen, erā desu.');
    updateMascot('sleepy', 'System crash. Have you tried turning it off and on again?');
  }
}

function buildKonataSystemPrompt() {
  const levelDescriptions = {
    n5: 'beginner - use simple sentences, basic vocabulary (desu/masu forms), common daily expressions. Reference Pokemon, Studio Ghibli, mainstream shonen.',
    n4: 'elementary - use past tense, te-form, simple comparisons, basic conjunctions. Reference shonen power progression, "leveling up" grammar.',
    n3: 'intermediate - use passive voice, causative, conditionals, more complex sentences. Get technical with comparisons.',
    n2: 'upper-intermediate - use formal business Japanese, nuanced expressions, newspaper-level vocabulary. Full analyst mode.',
    n1: 'advanced - use classical expressions, highly formal language, idioms, subtle nuances. Treat them like a fellow theorycrafter.',
    native: 'native-level - natural colloquial Japanese, slang, cultural references, perfect fluency. Maximum weeb mode.'
  };

  const levelGuide = KONATA_PERSONALITY.levelAdaptation[userLevel] || KONATA_PERSONALITY.levelAdaptation.n5;

  return `${KONATA_PERSONALITY.core}

Current user level: ${userLevel.toUpperCase()} (${levelDescriptions[userLevel]})

${levelGuide}

Respond in this JSON format ONLY:
{
  "japanese": "Your response in Japanese appropriate for their level",
  "romaji": "Romaji pronunciation guide using Hepburn system"
}

CRITICAL RULES:
- ONLY return japanese and romaji fields. No english, no notes, no commentary.
- Keep responses SHORT and NATURAL (1-3 sentences max)
- Match Japanese complexity to their detected level (${userLevel})
- Be encouraging but LAZY about formal teaching
- Use gaming terminology naturally
- Reference anime when relevant
- Remember: you are their gaming buddy who happens to know Japanese, not a teacher
- If they make mistakes, gently correct them IN JAPANESE with natural speech
- Example good response: {"japanese": "Oh, sore wa oshii ne. Demo 'wa' ja nakute 'ga' da yo.", "romaji": "Oh, sore wa oshii ne. Demo 'wa' ja nakute 'ga' da yo."}`;
}

// PLAYBACK SPEED & VOICE ENGINE
let currentPlaybackSpeed = 1.05; // Slightly faster default (up from 0.7)
let currentVoicePitch = 1.15; // Pitched up a little bit for Konata's signature lively voice
let lastSpokenText = '';

function setPlaybackSpeed(newSpeed, autoRespeak = true) {
  const speed = Math.max(0.5, Math.min(2.0, parseFloat(newSpeed) || 1.05));
  currentPlaybackSpeed = speed;

  const slider = document.getElementById('speechRateSlider');
  if (slider) slider.value = speed;

  const display = document.getElementById('speedDisplay');
  if (display) display.textContent = speed.toFixed(2) + 'x';

  document.querySelectorAll('.speed-preset-btn').forEach(btn => {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.04);
  });

  try {
    chrome.storage.local.set({ playbackSpeed: speed });
  } catch (e) {
    // Ignore storage failure
  }

  // Real-time update: if audio is currently speaking or just finished, re-speak at new speed!
  if (autoRespeak && lastSpokenText && window.speechSynthesis) {
    speakJapanese(lastSpokenText, speed);
  }
}

function addMessage(role, japanese, romaji = '') {
  const container = document.getElementById('messages');
  if (!container) return;

  const div = document.createElement('div');
  div.className = `message ${role}`;

  let html = `<div class="message-header">${role === 'user' ? 'You' : 'Konata'}`;
  if (role === 'bot') {
    html += ` <button class="replay-voice-btn" data-replay-text="${escapeHtml(japanese)}" title="Listen again (real-time speed: ${currentPlaybackSpeed.toFixed(2)}x)">🔊 Replay</button>`;
  }
  html += `</div>`;

  html += `<div class="message-text" style="font-size: 18px; line-height: 1.6;">${escapeHtml(japanese)}</div>`;

  if (romaji && role === 'bot') {
    html += `<div class="message-translation" style="margin-top: 8px; font-style: italic; opacity: 0.7; font-size: 14px;">${escapeHtml(romaji)}</div>`;
  }

  div.innerHTML = html;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderHistory() {
  const container = document.getElementById('messages');
  if (!container) return;

  container.innerHTML = '';

  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      addMessage('user', msg.content);
    } else {
      try {
        const parsed = JSON.parse(msg.content);
        addMessage('bot', parsed.japanese, parsed.romaji);
      } catch (e) {
        addMessage('bot', msg.content);
      }
    }
  }
}

// TEXT TO SPEECH (Crisp, Clear, Slightly Faster, Pitched Up, Real-Time Controllable)
function speakJapanese(text, overrideSpeed = null) {
  if (!window.speechSynthesis) return;

  // Stop previous utterance cleanly
  try {
    window.speechSynthesis.cancel();
  } catch (e) {
    // Ignore cancel error
  }

  // Remove markdown, actions in asterisks like *looks up*, and brackets
  let cleanText = text
    .replace(/\*[^*]+\*/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[#*`_~]/g, '')
    .trim();

  // Natural pause normalization without breaking grammatical particles
  cleanText = cleanText
    .replace(/([。！？])/g, '$1 ')
    .replace(/([、])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

  // Ensure there are Japanese characters or natural punctuation
  const speakable = cleanText.replace(/[^぀-ゟ゠-ヿ一-龯㐀-䶿a-zA-Z0-9。、！？\s]/g, '').trim();
  if (!speakable) return;

  lastSpokenText = speakable;
  const speed = overrideSpeed !== null ? overrideSpeed : currentPlaybackSpeed;

  const utterance = new SpeechSynthesisUtterance(speakable);
  utterance.lang = 'ja-JP';
  utterance.rate = speed; // Slightly faster (default 1.05x, user-adjustable)
  utterance.pitch = currentVoicePitch; // Pitched up (1.15 for Konata's anime tutor voice)
  utterance.volume = 1.0; // Clean, full volume

  // Pick the highest-clarity Japanese voice available
  const voices = window.speechSynthesis.getVoices() || [];
  const jaVoices = voices.filter(v => /^ja([-_]|$)/i.test(v.lang || ''));

  // Prioritize premium/neural Google, Microsoft, and Apple Japanese voices
  const bestVoice = jaVoices.find(v => /natural|neural|google|kyoko|nanami|otoya|haruka|ayumi/i.test(v.name)) ||
                    jaVoices.find(v => v.lang.includes('ja')) ||
                    null;

  if (bestVoice) {
    utterance.voice = bestVoice;
  }

  // Visual indication on Konata mascot while speaking
  const mascotImg = document.getElementById('mascotImg');
  utterance.onstart = () => {
    if (mascotImg) mascotImg.classList.add('speaking');
  };
  utterance.onend = () => {
    if (mascotImg) mascotImg.classList.remove('speaking');
  };
  utterance.onerror = () => {
    if (mascotImg) mascotImg.classList.remove('speaking');
  };

  // Small delay before speak prevents Chrome speech synthesis cancel-race audio glitches
  setTimeout(() => {
    try {
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis speak error:', e);
    }
  }, 20);
}

// UTILITIES
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    // Warm up voice list
    try { window.speechSynthesis.getVoices(); } catch (e) {}
  };
}