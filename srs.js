

let cards = [];
let currentCard = null;
let sessionCount = 0;
let currentMode = 'review';

const fsrs = new FSRS();

// Default settings - Manga Ink style
const DEFAULT_SETTINGS = {
  primaryColor: '#f59e0b',
  bgImage: null,
  fontFamily: "'Zen Maru Gothic', 'Comic Neue', 'Hiragino Maru Gothic ProN', sans-serif",
  wordSize: 56,
  readingSize: 28,
  theme: 'light',
  sentenceFront: true,
  autoplay: false,
  showImages: true
};

let currentSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadBlockedPictures();
  setupAudioControls();
  setupMediaControls();
  loadCards();
  setupNavigation();
  setupKeyboardShortcuts();
  setupSettings();
  
  if (window.location.hash === '#browse') {
    switchMode('browse');
  }
});

// ========== SETTINGS ==========

async function loadSettings() {
  const data = await chrome.storage.local.get('srsSettings');
  const settings = { ...DEFAULT_SETTINGS, ...data.srsSettings };
  currentSettings = settings;
  applySettings(settings);
  updateSettingsUI(settings);
  const na = await chrome.storage.local.get('nativeAudio');
  document.getElementById('nativeAudioToggle').checked = na.nativeAudio !== false;
}

function applySettings(settings) {
  const root = document.documentElement;
  
  // Primary color
  root.style.setProperty('--primary', settings.primaryColor);
  root.style.setProperty('--primary-hover', adjustBrightness(settings.primaryColor, -20));
  
  // Font
  root.style.setProperty('--font-family', settings.fontFamily);
  
  // Sizes
  root.style.setProperty('--font-size-word', settings.wordSize + 'px');
  root.style.setProperty('--font-size-reading', settings.readingSize + 'px');
  
  // Background
  if (settings.bgImage) {
    root.style.setProperty('--bg-image', `url(${settings.bgImage})`);
    root.style.setProperty('--bg-color', 'rgba(243, 244, 246, 0.95)');
  } else {
    root.style.setProperty('--bg-image', 'none');
    root.style.setProperty('--bg-color', '#f3f4f6');
  }
  
  // Theme
  if (settings.theme === 'dark') {
    applyDarkMode();
  } else if (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyDarkMode();
  } else {
    applyLightMode();
  }
}

function applyDarkMode() {
  const root = document.documentElement;
  root.style.setProperty('--bg-color', '#111827');
  root.style.setProperty('--card-bg', '#1f2937');
  root.style.setProperty('--text-color', '#f9fafb');
  root.style.setProperty('--reading-color', '#9ca3af');
  
  const bgImage = getComputedStyle(root).getPropertyValue('--bg-image');
  if (bgImage !== 'none') {
    root.style.setProperty('--bg-color', 'rgba(17, 24, 39, 0.95)');
  }
}

function applyLightMode() {
  const root = document.documentElement;
  root.style.setProperty('--bg-color', '#f3f4f6');
  root.style.setProperty('--card-bg', '#ffffff');
  root.style.setProperty('--text-color', '#111827');
  root.style.setProperty('--reading-color', '#6b7280');
}

function adjustBrightness(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255))
    .toString(16).slice(1);
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ srsSettings: settings });
  currentSettings = settings;
  applySettings(settings);
}

function updateSettingsUI(settings) {
  document.getElementById('primaryColor').value = settings.primaryColor;
  document.getElementById('wordSize').value = settings.wordSize;
  document.getElementById('wordSizeValue').textContent = settings.wordSize + 'px';
  document.getElementById('readingSize').value = settings.readingSize;
  document.getElementById('readingSizeValue').textContent = settings.readingSize + 'px';
  document.getElementById('themeSelect').value = settings.theme;
  document.getElementById('sentenceFrontToggle').checked = settings.sentenceFront !== false;
  document.getElementById('autoplayToggle').checked = !!settings.autoplay;
  document.getElementById('showImagesToggle').checked = settings.showImages !== false;
  
  document.querySelectorAll('.font-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.font === settings.fontFamily);
  });
  
  const bgPreview = document.getElementById('bgPreview');
  if (settings.bgImage) {
    bgPreview.style.backgroundImage = `url(${settings.bgImage})`;
    bgPreview.classList.add('has-image');
    bgPreview.querySelector('span').textContent = '';
    document.getElementById('removeBg').classList.remove('hidden');
  }
}

function setupSettings() {
  const panel = document.getElementById('settingsPanel');
  const overlay = document.getElementById('settingsOverlay');
  
  function openSettings() {
    panel.classList.add('open');
    overlay.classList.add('open');
  }
  
  function closeSettings() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  }
  
  document.getElementById('openSettings').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  overlay.addEventListener('click', closeSettings);
  
  document.getElementById('primaryColor').addEventListener('input', async (e) => {
    const settings = await getSettings();
    settings.primaryColor = e.target.value;
    await saveSettings(settings);
  });
  
  document.querySelectorAll('.color-box').forEach(box => {
    box.addEventListener('click', async () => {
      const color = box.dataset.color;
      document.getElementById('primaryColor').value = color;
      const settings = await getSettings();
      settings.primaryColor = color;
      await saveSettings(settings);
    });
  });
  
  document.getElementById('bgUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async () => {
      const settings = await getSettings();
      settings.bgImage = reader.result;
      await saveSettings(settings);
      updateSettingsUI(settings);
    };
    reader.readAsDataURL(file);
  });
  
  document.getElementById('removeBg').addEventListener('click', async (e) => {
    e.stopPropagation();
    const settings = await getSettings();
    settings.bgImage = null;
    await saveSettings(settings);
    updateSettingsUI(settings);
    document.getElementById('bgUpload').value = '';
    document.getElementById('bgPreview').style.backgroundImage = '';
    document.getElementById('bgPreview').classList.remove('has-image');
    document.getElementById('bgPreview').querySelector('span').textContent = 'Drop image or click to upload';
    document.getElementById('removeBg').classList.add('hidden');
  });
  
  document.querySelectorAll('.font-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      document.querySelectorAll('.font-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const settings = await getSettings();
      settings.fontFamily = opt.dataset.font;
      await saveSettings(settings);
    });
  });
  
  document.getElementById('wordSize').addEventListener('input', async (e) => {
    document.getElementById('wordSizeValue').textContent = e.target.value + 'px';
    const settings = await getSettings();
    settings.wordSize = parseInt(e.target.value);
    await saveSettings(settings);
  });
  
  document.getElementById('readingSize').addEventListener('input', async (e) => {
    document.getElementById('readingSizeValue').textContent = e.target.value + 'px';
    const settings = await getSettings();
    settings.readingSize = parseInt(e.target.value);
    await saveSettings(settings);
  });
  
  document.getElementById('themeSelect').addEventListener('change', async (e) => {
    const settings = await getSettings();
    settings.theme = e.target.value;
    await saveSettings(settings);
  });
  
  document.getElementById('sentenceFrontToggle').addEventListener('change', async (e) => {
    const settings = await getSettings();
    settings.sentenceFront = e.target.checked;
    await saveSettings(settings);
    const answerOpen = document.querySelector('#reviewCard .answer-section');
    if (currentCard && currentMode === 'review' && !answerOpen) renderCard(currentCard);
  });

  document.getElementById('autoplayToggle').addEventListener('change', async (e) => {
    const settings = await getSettings();
    settings.autoplay = e.target.checked;
    await saveSettings(settings);
  });

  document.getElementById('showImagesToggle').addEventListener('change', async (e) => {
    const settings = await getSettings();
    settings.showImages = e.target.checked;
    await saveSettings(settings);
  });

  document.getElementById('clearBlocked').addEventListener('click', async () => {
    blockedPictures = new Set();
    await chrome.storage.local.set({ pictureBlocklist: [] });
    updateBlockedUI();
  });

  document.getElementById('nativeAudioToggle').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ nativeAudio: e.target.checked });
  });

  document.getElementById('resetSettings').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    await chrome.storage.local.set({ srsSettings: DEFAULT_SETTINGS });
    applySettings(DEFAULT_SETTINGS);
    updateSettingsUI(DEFAULT_SETTINGS);
    currentSettings = { ...DEFAULT_SETTINGS };
    await chrome.storage.local.set({ nativeAudio: true });
    document.getElementById('nativeAudioToggle').checked = true;
    document.getElementById('bgUpload').value = '';
    document.getElementById('bgPreview').style.backgroundImage = '';
    document.getElementById('bgPreview').classList.remove('has-image');
    document.getElementById('bgPreview').querySelector('span').textContent = 'Drop image or click to upload';
    document.getElementById('removeBg').classList.add('hidden');
  });
}

async function getSettings() {
  const data = await chrome.storage.local.get('srsSettings');
  return { ...DEFAULT_SETTINGS, ...data.srsSettings };
}

// ========== CARDS & SRS ==========

async function loadCards() {
  const data = await chrome.storage.local.get('srsCards');
  cards = data.srsCards || [];
  updateStats();
  
  if (currentMode === 'review') {
    showNextCard();
  } else {
    renderBrowse();
  }
}

function updateStats() {
  const now = new Date();
  const newCards = cards.filter(c => c.state === 0);
  const learning = cards.filter(c => c.state === 1 || c.state === 3);
  const review = cards.filter(c => c.state === 2 && new Date(c.due) <= now);
  
  document.getElementById('statNew').textContent = newCards.length;
  document.getElementById('statLearning').textContent = learning.length;
  document.getElementById('statReview').textContent = review.length;
}

function getDueCards() {
  const now = new Date();
  return cards
    .filter(c => new Date(c.due) <= now)
    .sort((a, b) => {
      if (a.state !== b.state) return a.state - b.state;
      return new Date(a.due) - new Date(b.due);
    });
}

function showNextCard() {
  const dueCards = getDueCards();
  
  if (dueCards.length === 0) {
    showEmptyState();
    return;
  }
  
  currentCard = dueCards[0];
  
  // Ensure card is visible
  document.getElementById('reviewCard').classList.remove('hidden');
  document.getElementById('emptyState').classList.add('hidden');
  
  renderCard(currentCard);
}

function renderCard(card) {
  const container = document.getElementById('reviewCard');
  const ratingButtons = document.getElementById('ratingButtons');
  
  ratingButtons.classList.add('hidden');
  NA.stop();
  
  const stateNames = ['New', 'Learning', 'Review', 'Relearning'];
  const stateClass = stateNames[card.state].toLowerCase();
  
  const retrievability = fsrs.getRetrievability(card);
  const reading = card.reading || '';
  const showSentence = currentSettings.sentenceFront !== false && card.sentenceJP;
  const [ss, sl] = sentenceSpan(card);
  const hasPitch = Array.isArray(card.pitch) && card.pitch.length > 0;
  
  container.innerHTML = `
    <div class="card-header">
      <span class="card-state ${stateClass}">${stateNames[card.state]}</span>
      <span class="retrievability">Memory: ${Math.round(retrievability * 100)}%</span>
    </div>
    <div class="card-content">
      <div class="word" lang="ja">${escapeHtml(card.word)}</div>
      <div class="reading-wrap">
        ${reading ? `<div class="reading" lang="ja"><span id="readingText"${hasPitch ? ' hidden' : ''}>${escapeHtml(reading)}</span><span id="pitchSlot">${pitchHTML(reading, card.pitch)}</span></div>` : ''}
        <div class="audio-row">
          <button class="audio-btn primary" data-audio="word" title="Play pronunciation (V)">🔊 Play</button>
          <button class="audio-btn alt" data-audio="slow" title="Play slowly">🐢 Slow</button>
          ${card.sentenceJP ? '<button class="audio-btn" data-audio="sentence" title="Play the sentence (S)">🔊 Sentence</button>' : ''}
        </div>
        <div class="audio-hint" id="audioHint" role="status"></div>
      </div>
      ${showSentence ? `<div class="front-sentence" lang="ja">${NC.highlightText(card.sentenceJP, ss, sl)}</div>` : ''}
      <button class="show-answer-btn" id="showAnswerBtn">Show Answer (Space)</button>
    </div>
  `;
  
  document.getElementById('showAnswerBtn').addEventListener('click', showAnswer);
  ensurePitch(card);
  prepareMedia(card); // the picture downloads while you think, so it is ready when you flip
  if (currentSettings.autoplay) playCardAudio('word');
}

function showAnswer() {
  if (!currentCard) return;
  
  const container = document.getElementById('reviewCard');
  const ratingButtons = document.getElementById('ratingButtons');
  if (container.querySelector('.answer-section')) return; // already showing
  
  const scheduling = fsrs.schedule(currentCard);
  
  const formatInterval = (days) => {
    if (days === 0) return '< 1m';
    if (days < 1) return Math.round(days * 24) + 'h';
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return Math.round(days / 365) + 'y';
  };
  
  document.getElementById('intAgain').textContent = formatInterval(scheduling[1].interval);
  document.getElementById('intHard').textContent = formatInterval(scheduling[2].interval);
  document.getElementById('intGood').textContent = formatInterval(scheduling[3].interval);
  document.getElementById('intEasy').textContent = formatInterval(scheduling[4].interval);
  
  // the Context box below repeats the sentence, so drop the front copy to avoid showing it twice
  const frontSentence = container.querySelector('.front-sentence');
  if (frontSentence) frontSentence.remove();
  
  container.insertAdjacentHTML('beforeend', buildAnswerHTML(currentCard));
  ratingButtons.classList.remove('hidden');
  enrichAnswer(currentCard);
  fillMedia(currentCard);
}

async function rateCard(rating) {
  if (!currentCard) return;
  
  const result = fsrs.schedule(currentCard, new Date())[rating];
  const updatedCard = result.card;
  
  const index = cards.findIndex(c => c.id === currentCard.id);
  if (index >= 0) {
    cards[index] = updatedCard;
    await chrome.storage.local.set({ srsCards: cards });
  }
  
  sessionCount++;
  updateStats();
  showNextCard();
}

function showEmptyState() {
  document.getElementById('reviewCard').classList.add('hidden');
  document.getElementById('ratingButtons').classList.add('hidden');
  document.getElementById('emptyState').classList.remove('hidden');
  document.getElementById('sessionCount').textContent = sessionCount;
  
  const futureCards = cards.filter(c => new Date(c.due) > new Date());
  if (futureCards.length > 0) {
    const nextDue = new Date(Math.min(...futureCards.map(c => new Date(c.due))));
    document.getElementById('nextReviewTime').textContent = nextDue.toLocaleString();
  } else {
    document.getElementById('nextReviewTime').textContent = 'No cards scheduled';
  }
}

// ========== BROWSE MODE ==========

function renderBrowse(filter = 'all') {
  const grid = document.getElementById('cardsGrid');
  const now = new Date();
  
  let filtered = cards;
  if (filter === 'due') filtered = cards.filter(c => new Date(c.due) <= now);
  else if (filter === 'new') filtered = cards.filter(c => c.state === 0);
  else if (filter === 'learning') filtered = cards.filter(c => c.state === 1 || c.state === 3);
  else if (filter === 'review') filtered = cards.filter(c => c.state === 2);
  
  grid.innerHTML = filtered.map(card => `
    <div class="card-preview" data-card-id="${card.id}">
      <button class="delete-btn" data-delete-id="${card.id}" title="Delete card">×</button>
      <div class="word-small">${escapeHtml(card.word)}</div>
      <div class="reading-small">${escapeHtml(card.reading || '')}</div>
      ${card.contextMeaning ? `<div class="snippet">${escapeHtml(card.contextMeaning)}</div>` : ''}
      <div class="meta">
        <span class="card-state ${['new', 'learning', 'review', 'relearning'][card.state]}">
          ${['New', 'Learning', 'Review', 'Relearning'][card.state]}
        </span>
        <span class="due">Due: ${new Date(card.due).toLocaleDateString()}</span>
      </div>
    </div>
  `).join('');

  // Add delete event listeners
  grid.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteId;
      handleDelete(id);
    });
  });
}

async function handleDelete(id) {
  if (!confirm('Delete this card?')) return;
  
  const card = cards.find(c => c.id === id);
  if (!card) return;
  
  cards = cards.filter(c => c.id !== id);
  await chrome.storage.local.set({ srsCards: cards });
  
  // Refresh current view
  if (currentMode === 'browse') {
    renderBrowse(document.querySelector('.filter-btn.active')?.dataset.filter || 'all');
  }
  updateStats();
}

// ========== NAVIGATION ==========

function setupNavigation() {
  document.getElementById('navReview').addEventListener('click', () => switchMode('review'));
  document.getElementById('navBrowse').addEventListener('click', () => switchMode('browse'));
  
  // AI Chat navigation - THIS IS THE FIX
  const aiChatBtn = document.getElementById('aiChatBtn');
  if (aiChatBtn) {
    aiChatBtn.addEventListener('click', () => {
      window.location.href = 'chatbot.html';
    });
  }
  
  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rating = parseInt(e.currentTarget.dataset.rating);
      rateCard(rating);
    });
  });
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      renderBrowse(e.target.dataset.filter);
    });
  });
}

function switchMode(mode) {
  currentMode = mode;
  document.getElementById('reviewMode').classList.toggle('hidden', mode !== 'review');
  document.getElementById('browseMode').classList.toggle('hidden', mode !== 'browse');
  document.getElementById('navReview').classList.toggle('active', mode === 'review');
  document.getElementById('navBrowse').classList.toggle('active', mode === 'browse');
  
  if (mode === 'review') {
    showNextCard();
  } else {
    renderBrowse();
  }
}

// ========== KEYBOARD SHORTCUTS ==========

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (currentMode !== 'review') return;
    
    const typing = e.target && e.target.closest && e.target.closest('input, select, textarea');
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'v' || e.key === 'V') playCardAudio('word');
      else if (e.key === 's' || e.key === 'S') playCardAudio('sentence');
      else if (e.key === 'i' || e.key === 'I') swapPicture(false);
    }
    
    const ratingButtons = document.getElementById('ratingButtons');
    const isAnswerVisible = !ratingButtons.classList.contains('hidden');
    
    if (!isAnswerVisible && e.code === 'Space') {
      e.preventDefault();
      showAnswer();
    }
    
    if (isAnswerVisible) {
      switch(e.key) {
        case '1': rateCard(1); break;
        case '2': rateCard(2); break;
        case '3': rateCard(3); break;
        case '4': rateCard(4); break;
      }
    }
  });
}

// ========== PRONUNCIATION, CONTEXT & EXTRA INFO ==========

const NC = window.NihonCore;
const NA = window.NihonAudio;

function sendMsg(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError;
        resolve(err || !r ? { ok: false, error: err ? err.message : 'No response' } : r);
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

// Merge new info into a saved card (looked up by id, so it survives re-rating)
async function patchCard(id, patch) {
  const c = cards.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, patch);
  await chrome.storage.local.set({ srsCards: cards });
  return c;
}

function pitchHTML(reading, accents) {
  if (!reading || !accents || !accents.length) return '';
  return accents.map((a) => {
    const p = NC.pitchPattern(reading, a.n);
    const m = p.morae.map((x, i) =>
      `<span class="pm${p.heights[i] ? ' h' : ''}${p.dropAfter === i ? ' d' : ''}">${escapeHtml(x)}</span>`).join('');
    const label = `[${a.n}] ${p.type}` + (a.note ? ` (${a.note})` : '');
    return `<span class="pt" title="${escapeHtml(label)}">${m}<span class="pn">[${a.n}]</span></span>`;
  }).join('');
}

// Where is the clicked word inside the saved sentence?  -> [start, length] or [-1, 0]
function sentenceSpan(card) {
  const s = card.sentenceJP || '';
  const surf = card.surface || card.word || '';
  if (Number.isInteger(card.spanStart) && card.spanStart >= 0 && card.spanLen > 0 &&
      s.substr(card.spanStart, card.spanLen) === surf) return [card.spanStart, card.spanLen];
  let i = surf ? s.indexOf(surf) : -1;
  if (i >= 0) return [i, surf.length];
  i = card.word ? s.indexOf(card.word) : -1;
  return i >= 0 ? [i, card.word.length] : [-1, 0];
}

function setupAudioControls() {
  document.getElementById('reviewCard').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-audio]');
    if (b) { playCardAudio(b.dataset.audio); return; }
    const ex = e.target.closest && e.target.closest('[data-ex-audio]');
    if (ex) playExample(Number(ex.dataset.exAudio));
  });
}

let hintTimer = null;
function audioHint(msg) {
  const el = document.getElementById('audioHint');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.textContent = ''; }, 4500);
}
const noVoiceMsg = () => (NA.hasVoice()
  ? "Couldn't play audio."
  : 'No Japanese voice found. Install one in your system speech settings (or use Chrome with Google voices).');

async function playCardAudio(kind) {
  const card = currentCard;
  if (!card) return;
  try {
    if (kind === 'sentence') {
      if (!card.sentenceJP) return;
      const surface = card.surface || card.word;
      const reading = card.surfaceReading || (surface === card.word ? card.reading : '');
      await NA.playSentence({ sentence: card.sentenceJP, surface, reading });
    } else {
      await NA.playWord({
        word: NC.hasKanji(card.word) ? card.word : '',
        reading: card.reading || card.word,
        native: kind !== 'slow',
        rate: kind === 'slow' ? 0.65 : 1
      });
    }
  } catch (e) {
    audioHint(noVoiceMsg());
  }
}

function playExample(i) {
  const ex = currentCard && currentCard.examples && currentCard.examples[i];
  if (ex) NA.playSentence({ sentence: ex.jp }).catch(() => audioHint(noVoiceMsg()));
}

function sensesHTML(card) {
  let last = null;
  let html = '<div class="meaning-list">';
  card.senses.forEach((s, i) => {
    const key = (s.pos || []).join(', ');
    if (key !== last) { html += `<div class="pos-label">${escapeHtml(key || '—')}</div>`; last = key; }
    const meta = [].concat(s.tags || [], s.info || [], (s.restrictions || []).map((r) => 'only: ' + r));
    const xr = [];
    if (s.seeAlso && s.seeAlso.length) xr.push('see also: ' + s.seeAlso.map(escapeHtml).join(', '));
    if (s.antonyms && s.antonyms.length) xr.push('antonym: ' + s.antonyms.map(escapeHtml).join(', '));
    html += `<div class="sense${card.pinSense === i ? ' pinned' : ''}"><span class="sn">${i + 1}</span><div>
      <div class="sdef">${escapeHtml((s.defs || []).join('; '))}</div>
      ${meta.length ? `<div class="smeta">${meta.map((m) => `<span class="pill soft">${escapeHtml(m)}</span>`).join('')}</div>` : ''}
      ${xr.length ? `<div class="credit">${xr.join(' · ')}</div>` : ''}</div></div>`;
  });
  return html + '</div>';
}

function gradeLabel(g) {
  if (g == null) return '';
  if (g >= 1 && g <= 6) return `Grade ${g}`;
  if (g === 8) return 'Jōyō (secondary)';
  if (g === 9 || g === 10) return 'Jinmeiyō (names)';
  return '';
}

function kanjiHTML(list) {
  if (!list || !list.length) return '';
  return '<div class="kanji-grid">' + list.map((k) => {
    const pills = [];
    if (k.strokes) pills.push(`<span class="pill">${k.strokes} strokes</span>`);
    if (gradeLabel(k.grade)) pills.push(`<span class="pill lvl">${gradeLabel(k.grade)}</span>`);
    if (k.freq) pills.push(`<span class="pill freq">news #${k.freq}</span>`);
    return `<div class="kcard"><div class="kglyph" lang="ja">${escapeHtml(k.kanji)}</div><div>
      <div class="kmean">${escapeHtml((k.meanings || []).slice(0, 5).join(', ') || '—')}</div>
      ${k.on && k.on.length ? `<div class="kread" lang="ja"><b>On</b> ${escapeHtml(k.on.join('、'))}</div>` : ''}
      ${k.kun && k.kun.length ? `<div class="kread" lang="ja"><b>Kun</b> ${escapeHtml(k.kun.join('、'))}</div>` : ''}
      <div class="smeta" style="margin-top:6px">${pills.join('')}</div></div></div>`;
  }).join('') + '</div><div class="credit">Kanji data: kanjiapi.dev (KANJIDIC2)</div>';
}

function examplesHTML(list, card) {
  if (!list || !list.length) return '<div class="credit">No example sentences found for this word.</div>';
  const needles = [card.word, card.reading, card.surface];
  return '<div class="ex-list">' + list.map((x, i) => `<div class="ex">
    <button class="audio-btn mini" data-ex-audio="${i}" title="Play sentence" aria-label="Play example sentence">🔊</button>
    <div><div class="ex-jp" lang="ja">${NC.rubyHTML(NC.markSegments(x.segs, needles))}</div><div class="ex-en">${escapeHtml(x.en)}</div></div>
  </div>`).join('') + '</div><div class="credit">Sentences: Tatoeba (CC BY 2.0 FR)</div>';
}

function buildAnswerHTML(card) {
  const pills = [];
  if (card.common) pills.push('<span class="pill common">★ common</span>');
  (card.jlpt || []).forEach((l) => pills.push(`<span class="pill lvl">JLPT ${escapeHtml(l)}</span>`));
  if (card.wk) pills.push(`<span class="pill lvl">WaniKani ${escapeHtml(String(card.wk))}</span>`);
  if (card.freq) {
    Object.keys(card.freq).forEach((k) => pills.push(
      `<span class="pill freq">${escapeHtml(card.freq[k].label)} #${Number(card.freq[k].rank).toLocaleString()}</span>`));
  }
  if (card.isName) pills.push('<span class="pill name">name</span>');
  if (card.inflection && card.inflection.length && card.surface && card.surface !== card.word) {
    pills.push(`<span class="pill soft" lang="ja">${escapeHtml(card.surface)} ← ${escapeHtml(card.word)}: ${escapeHtml(card.inflection.join(', '))}</span>`);
  }
  (card.pos || []).slice(0, 3).forEach((p) => pills.push(`<span class="pill soft">${escapeHtml(p)}</span>`));

  const by = { ai: 'AI', you: 'your pick', sentence: 'sentence match' }[card.contextBy] || '';
  const ctxMeaning = card.contextMeaning
    ? `<div class="ctx-meaning"><div class="ctx-meaning-label">In this sentence${by ? `<span class="by">${by}</span>` : ''}</div>
       <div class="ctx-meaning-text">${escapeHtml(card.contextMeaning)}</div>
       ${card.contextNote ? `<div class="ctx-note">${escapeHtml(card.contextNote)}</div>` : ''}</div>`
    : '';

  const meanings = card.senses && card.senses.length
    ? sensesHTML(card)
    : `<div class="meaning">${card.meaningHTML || ''}</div>`;

  const [ss, sl] = sentenceSpan(card);
  const hasSentence = !!card.sentenceJP;
  const contextBox = `<div class="context-box">
      <div class="context-label">Context</div>
      <div class="context-jp"><span class="cjp-text" lang="ja">${NC.highlightText(card.sentenceJP || '', ss, sl)}</span>
        ${hasSentence ? '<button class="audio-btn mini" data-audio="sentence" title="Play the sentence (S)" aria-label="Play the sentence">🔊</button>' : ''}</div>
      <div class="context-en">${escapeHtml(card.sentenceEN || '')}</div>
      ${card.sourceTitle ? `<div class="context-src">${escapeHtml(card.sourceTitle)}</div>` : ''}
    </div>`;

  const needKanji = NC.hasKanji(card.word);
  // with a picture: meanings on the left and the picture on the right (stacked on narrow screens)
  const topBlock = pictureWanted(card)
    ? `<div class="answer-split"><div class="answer-main">${ctxMeaning}${meanings}</div>${mediaSlotHTML()}</div>`
    : `${ctxMeaning}${meanings}`;
  return `<div class="answer-section">
      ${pills.length ? `<div class="pill-row">${pills.join('')}</div>` : ''}
      ${topBlock}
      ${contextBox}
      ${needKanji ? `<div class="section-title">Kanji</div><div id="kanjiSlot">${card.kanji && card.kanji.length ? kanjiHTML(card.kanji) : '<div class="credit">Loading kanji…</div>'}</div>` : ''}
      ${card.isName ? '' : `<div class="section-title">Examples</div><div id="examplesSlot">${Array.isArray(card.examples) ? examplesHTML(card.examples, card) : '<div class="credit">Loading examples…</div>'}</div>`}
      ${card.sourceURL ? `<a href="${escapeHtml(card.sourceURL)}" target="_blank" rel="noreferrer" class="source-link">Source ↗</a>` : ''}
    </div>`;
}

// Pitch accent for cards saved before this feature (or before the data finished downloading)
async function ensurePitch(card) {
  if (Array.isArray(card.pitch) || !(card.reading || card.word)) return;
  const r = await sendMsg({
    type: 'PITCH_LOOKUP',
    forms: [{ word: NC.hasKanji(card.word) ? card.word : null, reading: card.reading || card.word }]
  });
  if (!r.ok || r.status !== 'ready') return; // data not downloaded yet: try again next time
  const accents = r.results.length ? r.results[0].accents : [];
  await patchCard(card.id, { pitch: accents });
  if (currentCard && currentCard.id === card.id) {
    const slot = document.getElementById('pitchSlot');
    if (slot) slot.innerHTML = pitchHTML(card.reading || card.word, accents);
    const plain = document.getElementById('readingText');
    if (plain && accents.length) plain.hidden = true; // the pitch graph already spells the reading
  }
}

// Kanji breakdown + example sentences, fetched once and kept on the card
async function enrichAnswer(card) {
  const id = card.id;
  const visible = (slot) => currentCard && currentCard.id === id && document.getElementById(slot);
  const jobs = [];
  if (NC.hasKanji(card.word) && !(card.kanji && card.kanji.length)) {
    jobs.push((async () => {
      const r = await sendMsg({ type: 'KANJI_LOOKUP', chars: NC.kanjiOf(card.word).slice(0, 8) });
      if (r.ok && r.kanji.length) await patchCard(id, { kanji: r.kanji });
      const el = visible('kanjiSlot');
      if (el) el.innerHTML = r.ok && r.kanji.length ? kanjiHTML(r.kanji) : '<div class="credit">Kanji details are unavailable right now.</div>';
    })());
  }
  if (!card.isName && !Array.isArray(card.examples)) {
    jobs.push((async () => {
      const word = NC.hasKanji(card.word) || !card.reading ? card.word : card.reading;
      const r = await sendMsg({ type: 'EXAMPLES_LOOKUP', word, alt: [card.reading, card.surface].filter(Boolean), limit: 4 });
      if (r.ok) await patchCard(id, { examples: r.examples });
      const el = visible('examplesSlot');
      if (el) el.innerHTML = r.ok ? examplesHTML(r.examples, card) : '<div class="credit">Examples are unavailable right now.</div>';
    })());
  }
  await Promise.all(jobs);
}

// ========== CARD PICTURES ==========
// An anime GIF on the back of the card. It is looked up while the front is showing (so it is ready the moment
// you flip), remembered on the card, and can be swapped for another one or hidden for good. Names, grammar words
// and heavy topics get no picture at all (see picturePlan in core.js).

const mediaJobs = new Map();     // card id -> Promise<{ media, img } | null>
let blockedPictures = new Set(); // pictures you chose never to see again
let swapping = false;

const pictureWanted = (card) => currentSettings.showImages !== false && !NC.picturePlan(card).skip;

async function loadBlockedPictures() {
  const d = await chrome.storage.local.get('pictureBlocklist');
  blockedPictures = new Set(Array.isArray(d.pictureBlocklist) ? d.pictureBlocklist : []);
  updateBlockedUI();
}

function saveBlockedPictures() {
  const list = Array.from(blockedPictures).slice(-500);
  blockedPictures = new Set(list);
  updateBlockedUI();
  return chrome.storage.local.set({ pictureBlocklist: list });
}

function updateBlockedUI() {
  const n = blockedPictures.size;
  const label = document.getElementById('blockedCount');
  const btn = document.getElementById('clearBlocked');
  if (label) label.textContent = n === 1 ? '1 picture hidden' : `${n} pictures hidden`;
  if (btn) btn.disabled = n === 0;
}

async function requestPicture(card, avoid) {
  const plan = NC.picturePlan(card);
  const r = await sendMsg({ type: 'PICTURE_FETCH', word: card.word, category: plan.category, exclude: avoid });
  return r.ok && r.media ? r.media : null;
}

// Downloads the picture off-screen first, so it is only shown once it is complete and its real shape is known.
function loadPicture(media) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let timer = null;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    img.className = 'media-img';
    img.alt = media.anime ? `Anime GIF from ${media.anime}` : 'Anime GIF';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    timer = setTimeout(() => { img.removeAttribute('src'); finish(reject, new Error('timed out')); }, 15000);
    img.onload = () => (img.naturalWidth > 0 && img.naturalHeight > 0 ? finish(resolve, img) : finish(reject, new Error('empty image')));
    img.onerror = () => finish(reject, new Error('could not load'));
    img.src = media.url;
  });
}

// The picture saved on the card if it still loads, otherwise a fresh one (up to 3 tries). Never rejects.
async function resolvePicture(card, { fresh = false, avoid = [] } = {}) {
  try {
    const tried = avoid.slice();
    for (let i = 0; i < 3; i++) {
      const saved = card.media;
      let media = null;
      if (i === 0 && !fresh && saved && saved.url && !blockedPictures.has(saved.url) && !tried.includes(saved.url)) media = saved;
      else media = await requestPicture(card, tried);
      if (!media) return null;
      try {
        const img = await loadPicture(media);
        if (!saved || saved.url !== media.url) await patchCard(card.id, { media });
        return { media, img };
      } catch (e) {
        tried.push(media.url); // dead link or too slow: try another one
      }
    }
  } catch (e) { /* fall through */ }
  return null;
}

// Called when a card's front is shown.
function prepareMedia(card) {
  mediaJobs.forEach((_, id) => { if (id !== card.id) mediaJobs.delete(id); });
  if (!pictureWanted(card) || mediaJobs.has(card.id)) return;
  mediaJobs.set(card.id, resolvePicture(card));
}

// Called when the card is flipped.
async function fillMedia(card) {
  if (!pictureWanted(card)) return;
  prepareMedia(card);
  const job = mediaJobs.get(card.id);
  const result = await job;
  if (mediaJobs.get(card.id) === job) paintMedia(card, result); // a newer swap may have replaced this one
}

function mediaLoadingHTML() {
  return `<figure class="media-card is-loading">
      <div class="media-frame" style="aspect-ratio:16/10"><span class="media-wait">Fetching a picture…</span></div>
      <figcaption class="media-bar"><span class="media-credit">&nbsp;</span></figcaption>
    </figure>`;
}

function mediaSlotHTML() {
  return `<aside class="media-slot" id="mediaSlot" aria-label="A picture to help you remember this word">${mediaLoadingHTML()}</aside>`;
}

function paintMedia(card, result) {
  const slot = document.getElementById('mediaSlot');
  if (!slot || !currentCard || currentCard.id !== card.id) return;
  if (!result) {
    slot.innerHTML = `<figure class="media-card is-empty">
        <div class="media-frame"><span class="media-wait">No picture right now</span></div>
        <figcaption class="media-bar">
          <span class="media-credit">Couldn't load one</span>
          <span class="media-actions"><button type="button" class="media-btn" data-media="another" title="Try again (I)" aria-label="Try again">🔄</button></span>
        </figcaption>
      </figure>`;
    return;
  }
  const { media, img } = result;
  // the frame takes the picture's own shape (kept between square and wide), so nothing is stretched or cropped
  const ratio = Math.min(1.9, Math.max(1, img.naturalWidth / img.naturalHeight));
  slot.innerHTML = `<figure class="media-card">
      <div class="media-frame" style="aspect-ratio:${ratio.toFixed(3)}"></div>
      <figcaption class="media-bar">
        <span class="media-credit"></span>
        <span class="media-actions">
          <button type="button" class="media-btn" data-media="another" title="Another picture (I)" aria-label="Show another picture">🔄</button>
          <button type="button" class="media-btn" data-media="block" title="Don't show this one again" aria-label="Never show this picture again">🚫</button>
        </span>
      </figcaption>
    </figure>`;
  slot.querySelector('.media-frame').appendChild(img);
  const credit = slot.querySelector('.media-credit');
  if (media.anime) {
    const name = document.createElement('b');
    name.textContent = media.anime;
    credit.append('From ', name);
    credit.title = `From ${media.anime} · via ${media.provider}`;
  } else {
    credit.textContent = `Anime GIF · ${media.provider || ''}`;
    credit.title = media.provider ? `via ${media.provider}` : '';
  }
}

// 🔄 shows another picture; 🚫 does the same and also hides this one from now on.
async function swapPicture(block) {
  const card = currentCard;
  const slot = document.getElementById('mediaSlot');
  if (!card || !slot || swapping || currentMode !== 'review') return;
  swapping = true;
  try {
    const old = card.media && card.media.url;
    if (block && old) {
      blockedPictures.add(old);
      await saveBlockedPictures();
    }
    slot.innerHTML = mediaLoadingHTML();
    const job = resolvePicture(card, { fresh: true, avoid: old ? [old] : [] });
    mediaJobs.set(card.id, job);
    paintMedia(card, await job);
  } finally {
    swapping = false;
  }
}

function setupMediaControls() {
  document.getElementById('reviewCard').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-media]');
    if (b) swapPicture(b.dataset.media === 'block');
  });
}

// ========== UTILITIES ==========

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expose functions for any inline handlers (though we use event listeners now)
window.showAnswer = showAnswer;
window.rateCard = rateCard;