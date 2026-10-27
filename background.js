
importScripts('core.js');
const C = self.NihonCore;

const DEFAULT_AI_MODEL = 'gemini-2.5-flash-lite'; // same model the chatbot uses
const PITCH_URL = 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/94473cd69598abf54cc338a0b89f190a6c02a01c/data/source_files/raw/accents.txt';
const FREQ_SOURCES = {
  wikipedia: { label: 'Wikipedia', url: 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/wikipedia_freq.txt' },
  novels: { label: 'Novels', url: 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/novels_freq.txt' }
};
const FREQ_SANITY = ['の', 'に', 'は', 'を', 'が', 'する', 'ある', 'いる', 'これ', 'それ', 'こと', 'もの', 'ない', 'なる'];
const INVALID_AUDIO_SHA256 = 'ae6398b5a27bc8c0a771df6c907ade794be15518174773c58c7c7ddd17098906'; // JapanesePod101 "no audio" clip
const BUCKETS = 128;
const HOUR = 3600 * 1000;

// ------------------------------------------------------------------ helpers
const mem = new Map();
function memGet(key, ttl) {
  const hit = mem.get(key);
  return hit && Date.now() - hit.t < ttl ? hit.v : undefined;
}
function memSet(key, v) {
  mem.set(key, { t: Date.now(), v });
  if (mem.size > 500) mem.delete(mem.keys().next().value);
  return v;
}
const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function fetchResp(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 9000);
  try {
    const res = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
    if (!res.ok) {
      const e = new Error('HTTP ' + res.status);
      e.status = res.status;
      throw e;
    }
    return res;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function bucketOf(key) {
  let h = 5381;
  for (const ch of key) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h % BUCKETS;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function sha256hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// -------------------------------------------------------------------- Jisho
async function jishoRaw(q) {
  const key = 'jisho:' + q;
  const hit = memGet(key, 30 * 60 * 1000);
  if (hit) return hit;
  return once(key, async () => {
    const res = await fetchResp('https://jisho.org/api/v1/search/words?keyword=' + encodeURIComponent(q));
    const data = await res.json();
    if (data && data.meta && data.meta.status && data.meta.status !== 200) throw new Error('Jisho status ' + data.meta.status);
    return memSet(key, Array.isArray(data && data.data) ? data.data : []);
  });
}

const PREFIXES = ['お', 'ご', '御', '大', '小', '新', '旧', '元', '前', '後', '各', '全', '再', '非', '無', '不', '未', '超', '最', '現', '総', '副', '真', '初', '本', '同', '両', '諸'];
const NO_COMPOUND_AFTER = new Set(['は', 'が', 'を', 'に', 'へ', 'で', 'と', 'も', 'の', 'や', 'か', 'ね', 'よ', 'ぞ', 'ぜ', 'わ', 'さ',
  'から', 'まで', 'より', 'ので', 'のに', 'けど', 'けれど', 'でも', 'って', 'など', 'なら', 'て', 'た', 'だ', 'ない', 'なかっ', 'なけれ',
  'ます', 'ませ', 'まし', 'ましょ', 'れ', 'られ', 'せ', 'させ', 'たい', 'たく', 'たかっ', 'ば', 'よう', 'ず', 'ん', 'い']);

// Yomitan-style: look at the text starting at the click and keep the longest span that is a real word.
async function smartLookup(msg) {
  const tokens = (msg.tokens || []).filter(Boolean);
  const clicked = tokens[0] || String(msg.clicked || '');
  if (!clicked) throw new Error('Nothing to look up');
  if (!tokens.length) tokens.push(clicked);
  const prev = String(msg.prevToken || '');
  const joinTok = (a, b) => tokens.slice(a, b).join('');

  const windows = [];
  const addWin = (text, n, prefix, honorific) => {
    if (text && text.length <= 14 && !windows.some((w) => w.text === text)) windows.push({ text, n, prefix, honorific });
  };
  addWin(clicked, 1, false);
  // 茸さん is one token for the segmenter: also look up the name part on its own
  const honor = C.splitHonorific(clicked);
  if (honor) addWin(honor.stem, 1, false, honor.honorific);
  const canJoin = tokens.length > 1 && !NO_COMPOUND_AFTER.has(tokens[1]);
  if (canJoin) addWin(joinTok(0, 2), 2, false);
  if (canJoin && tokens.length > 2) addWin(joinTok(0, 3), 3, false);
  if (prev && PREFIXES.includes(prev)) {
    addWin(prev + clicked, 1, true);
    if (canJoin) addWin(prev + joinTok(0, 2), 2, true);
  }

  const results = await Promise.all(windows.map(async (w) => {
    try {
      const raw = await jishoRaw(w.text);
      return { w, entries: raw.slice(0, 8).map(C.normalizeJisho) };
    } catch (e) {
      return { w, entries: [], error: e };
    }
  }));
  const base = results[0];
  if (base.error && results.every((r) => r.error)) throw base.error;

  // candidates: [{text, n, prefix, kind, entries, inflection}]
  const accepted = [];
  for (const { w, entries } of results) {
    const exact = entries.filter((e) => C.entryMatchesSurface(e, w.text));
    if (exact.length) {
      accepted.push({ ...w, kind: 'exact', entries: exact, inflection: null });
      continue;
    }
    for (const e of entries.slice(0, 5)) {
      const m = C.matchInflection(w.text, e);
      if (m) { accepted.push({ ...w, kind: 'inflected', entries: [e], inflection: m }); break; }
    }
  }
  // longer conjugated spans (食べ|られ|なかっ|た) are validated locally, without more requests
  for (const e of base.entries.slice(0, 5)) {
    for (let k = 2; k <= Math.min(tokens.length, 7); k++) {
      const text = joinTok(0, k);
      if (text.length > 16) break;
      const m = C.matchInflection(text, e);
      if (m) accepted.push({ text, n: k, prefix: false, kind: 'inflected', entries: [e], inflection: m });
    }
  }

  let chosen;
  if (accepted.length) {
    accepted.sort((a, b) => b.text.length - a.text.length || (a.kind === 'exact' ? -1 : 1) - (b.kind === 'exact' ? -1 : 1));
    chosen = accepted[0];
  } else if (honor) {
    // "<unknown name>さん": don't present fuzzy dictionary guesses as if they were the word
    chosen = { text: honor.stem, n: 1, prefix: false, honorific: honor.honorific, kind: 'fallback', entries: [], inflection: null };
  } else {
    chosen = { ...base.w, kind: 'fallback', entries: base.entries, inflection: null };
  }

  const surface = chosen.text;
  const nameHint = chosen.honorific
    ? { likely: true, reason: 'followed by ' + chosen.honorific }
    : C.detectName(tokens[chosen.n], surface);
  let entries = C.rankEntries(chosen.entries, surface, { likelyName: nameHint.likely }).slice(0, 6);
  if (chosen.kind === 'inflected' && chosen.inflection) {
    const m = chosen.inflection;
    const head = entries.find((e) => e.word === m.base || C.matchInflection(surface, e));
    if (head) entries = [head, ...entries.filter((e) => e !== head)];
  }
  return {
    surface, prefixLen: chosen.prefix ? prev.length : 0, forwardTokens: chosen.n,
    kind: chosen.kind, approx: chosen.kind === 'fallback', entries,
    inflection: chosen.inflection ? { labels: chosen.inflection.labels, base: chosen.inflection.base } : null,
    likelyName: nameHint.likely, nameReason: nameHint.reason
  };
}

// -------------------------------------------------------------- translation
const decodeEntities = (s) => String(s).replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function translateJaEn(text) {
  text = String(text || '').trim();
  if (!text) return '';
  if (text.length > 480) text = text.slice(0, 480);
  const key = 'mt:' + text;
  const hit = memGet(key, 6 * HOUR);
  if (hit != null) return hit;
  return once(key, async () => {
    const res = await fetchResp('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=ja|en');
    const data = await res.json();
    const status = Number(data && data.responseStatus != null ? data.responseStatus : 200);
    let out = (data && data.responseData && data.responseData.translatedText) || (data && data.matches && data.matches[0] && data.matches[0].translation) || '';
    if (status !== 200 || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error(status === 429 ? 'Translation quota reached for today' : 'Translation unavailable');
    return memSet(key, decodeEntities(out));
  });
}

// ----------------------------------------------------------------- AI context
async function aiStatus() {
  const s = await chrome.storage.local.get(['geminiApiKey', 'aiModel', 'aiContextEnabled']);
  return { hasKey: !!s.geminiApiKey, enabled: s.aiContextEnabled !== false, model: s.aiModel || DEFAULT_AI_MODEL };
}

async function aiContext(msg) {
  const s = await chrome.storage.local.get(['geminiApiKey', 'aiModel', 'aiContextEnabled']);
  if (!s.geminiApiKey) throw coded('no-key', 'No Gemini API key saved');
  if (s.aiContextEnabled === false) throw coded('disabled', 'AI context is turned off');
  const entries = msg.entries || [];
  const key = 'ai:' + msg.sentence + '|' + msg.surface + '|' + entries.map((e) => e.slug).join(',');
  const hit = memGet(key, 24 * HOUR);
  if (hit) return { ai: hit };
  return once(key, async () => {
    const { system, user } = C.buildAIPrompt({ ...msg, entries });
    const model = s.aiModel || DEFAULT_AI_MODEL;
    let res;
    try {
      res = await fetchResp('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiApiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: 'application/json' }
        })
      }, 20000);
    } catch (e) {
      if (e.status === 429) throw coded('rate-limit', 'Gemini rate limit or daily quota reached');
      if (e.status === 400 || e.status === 403) throw coded('bad-key', 'Gemini rejected the request (check your API key)');
      throw coded('error', e.message);
    }
    const data = await res.json();
    const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
      .map((p) => p.text || '').join('');
    const parsed = C.parseAIResponse(text, entries);
    if (!parsed) throw coded('bad-response', 'Gemini returned something unreadable');
    memSet(key, parsed);
    return { ai: parsed };
  });
}

// ---------------------------------------------------------------------- kanji
async function kanjiLookup(msg) {
  const chars = (msg.chars || []).slice(0, 8);
  const store = (await chrome.storage.local.get('kanjiCache')).kanjiCache || {};
  let dirty = false;
  await Promise.all(chars.map(async (ch) => {
    if (store[ch]) return;
    try {
      const res = await fetchResp('https://kanjiapi.dev/v1/kanji/' + encodeURIComponent(ch), {}, 7000);
      const d = await res.json();
      store[ch] = {
        kanji: ch, grade: d.grade == null ? null : d.grade, strokes: d.stroke_count == null ? null : d.stroke_count,
        meanings: d.meanings || [], kun: d.kun_readings || [], on: d.on_readings || [], name: d.name_readings || [],
        heisig: d.heisig_en || null, freq: d.freq_mainichi_shinbun == null ? null : d.freq_mainichi_shinbun
      };
      dirty = true;
    } catch (e) { /* leave this kanji out */ }
  }));
  if (dirty) await chrome.storage.local.set({ kanjiCache: store });
  return { kanji: chars.map((c) => store[c]).filter(Boolean) };
}

// ------------------------------------------------------------------ examples
async function examplesLookup(msg) {
  const word = String(msg.word || '').replace(/"/g, '').trim();
  if (!word || (C.isKanaOnly(word) && word.length < 2)) return { examples: [] };
  const key = 'ex:' + word;
  const hit = memGet(key, 6 * HOUR);
  if (hit) return { examples: hit };
  return once(key, async () => {
    const params = new URLSearchParams({
      lang: 'jpn', q: '"' + word + '"', sort: 'relevance', 'trans:lang': 'eng',
      include: 'transcriptions,audios', limit: '25', is_unapproved: 'no'
    });
    const res = await fetchResp('https://api.tatoeba.org/v1/sentences?' + params.toString(), {}, 10000);
    const data = await res.json();
    const examples = C.pickExamples(data && data.data, [word].concat(msg.alt || []), msg.limit || 5);
    memSet(key, examples);
    return { examples };
  });
}

// --------------------------------------------------------- pitch accent data
let pitchBuild = null;
async function ensurePitch() {
  const meta = (await chrome.storage.local.get('pitchMeta')).pitchMeta;
  if (meta && meta.ok) return true;
  if (meta && meta.failedAt && Date.now() - meta.failedAt < HOUR) return false;
  if (!pitchBuild) pitchBuild = buildPitch().finally(() => { pitchBuild = null; });
  return pitchBuild;
}
async function buildPitch() {
  try {
    const res = await fetchResp(PITCH_URL, {}, 90000);
    const text = await res.text();
    const buckets = Array.from({ length: BUCKETS }, () => ({}));
    let count = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.replace(/\r$/, '').split('\t');
      const word = cols[0], reading = cols[1] || '', acc = cols[2];
      if (!word || !acc) continue;
      const key = C.normKey(word);
      const b = buckets[bucketOf(key)];
      (b[key] || (b[key] = [])).push([reading || word, acc]);
      count++;
    }
    if (count < 50000) throw new Error('pitch data looked too small');
    const items = { pitchMeta: { ok: true, count, t: Date.now() } };
    buckets.forEach((b, i) => { items['pitch:' + i] = b; });
    await chrome.storage.local.set(items);
    return true;
  } catch (e) {
    await chrome.storage.local.set({ pitchMeta: { ok: false, failedAt: Date.now(), error: String(e.message || e) } });
    return false;
  }
}

async function pitchLookup(msg) {
  if (!(await ensurePitch())) return { status: 'unavailable', results: [] };
  const forms = (msg.forms || []).slice(0, 14);
  const keyOf = (s) => C.normKey(s);
  const ids = new Set();
  forms.forEach((f) => { if (f.word) ids.add(bucketOf(keyOf(f.word))); if (f.reading) ids.add(bucketOf(keyOf(f.reading))); });
  const data = await chrome.storage.local.get(Array.from(ids, (i) => 'pitch:' + i));
  const find = (k, rd) => {
    const list = (data['pitch:' + bucketOf(k)] || {})[k] || [];
    return list.filter(([r]) => C.sameKana(r, rd));
  };
  const results = [];
  for (const f of forms) {
    const rd = f.reading || f.word;
    let hit = f.word ? find(keyOf(f.word), rd) : [];
    if (!hit.length && f.reading) hit = find(keyOf(f.reading), rd);
    if (!hit.length) continue;
    const seen = new Set();
    const accents = [];
    for (const [, a] of hit) for (const x of C.parseAccentField(a)) {
      const id = x.n + '|' + (x.note || '');
      if (!seen.has(id)) { seen.add(id); accents.push(x); }
    }
    if (accents.length) results.push({ word: f.word, reading: f.reading, accents });
  }
  return { status: 'ready', results };
}

// ------------------------------------------------------------ frequency data
const freqBuilds = {};
async function ensureFreq(src) {
  const metaAll = (await chrome.storage.local.get('freqMeta')).freqMeta || {};
  const meta = metaAll[src];
  if (meta && meta.ok) return true;
  if (meta && meta.failedAt && Date.now() - meta.failedAt < 24 * HOUR) return false;
  if (!freqBuilds[src]) freqBuilds[src] = buildFreq(src).finally(() => { delete freqBuilds[src]; });
  return freqBuilds[src];
}
async function setFreqMeta(src, v) {
  const all = (await chrome.storage.local.get('freqMeta')).freqMeta || {};
  all[src] = v;
  await chrome.storage.local.set({ freqMeta: all });
}
async function buildFreq(src) {
  try {
    const res = await fetchResp(FREQ_SOURCES[src].url, {}, 90000);
    const text = await res.text();
    const rows = [];
    for (const line of text.split('\n')) {
      const cols = line.replace(/\r$/, '').split('\t');
      if (cols.length < 2) continue;
      const word = cols[0].trim();
      let val = NaN;
      for (let i = cols.length - 1; i >= 1; i--) {
        const s = cols[i].trim();
        if (s !== '' && Number.isFinite(Number(s))) { val = Number(s); break; }
      }
      if (!word || !Number.isFinite(val)) continue;
      const rd = cols.length >= 3 && C.isKanaOnly(cols[1].trim()) ? C.kataToHira(cols[1].trim()) : '';
      rows.push([C.normKey(word), rd, val]);
    }
    if (rows.length < 5000) throw new Error('frequency list looked too small');
    let minV = Infinity, maxV = -Infinity;
    for (const r of rows) { if (r[2] < minV) minV = r[2]; if (r[2] > maxV) maxV = r[2]; }
    const looksLikeRanks = minV >= 1 && minV <= 2 && maxV <= rows.length * 1.1 &&
      new Set(rows.slice(0, 2000).map((r) => r[2])).size > 1900;
    let ranked;
    if (looksLikeRanks) ranked = rows;
    else { rows.sort((a, b) => b[2] - a[2]); ranked = rows.map((r, i) => [r[0], r[1], i + 1]); }
    const best = new Map();
    const put = (k, rank) => { if (!best.has(k) || rank < best.get(k)) best.set(k, rank); };
    for (const [k, rd, rank] of ranked) {
      if (rank > 60000) continue;
      put(k, rank);
      if (rd) put(k + '|' + rd, rank);
    }
    if (FREQ_SANITY.filter((w) => (best.get(w) || 1e9) <= 3000).length < 3) throw new Error('unexpected frequency format');
    const buckets = Array.from({ length: BUCKETS }, () => ({}));
    for (const [k, rank] of best) buckets[bucketOf(k.split('|')[0])][k] = rank;
    const items = {};
    buckets.forEach((b, i) => { items['freq:' + src + ':' + i] = b; });
    await chrome.storage.local.set(items);
    await setFreqMeta(src, { ok: true, t: Date.now() });
    return true;
  } catch (e) {
    await setFreqMeta(src, { ok: false, failedAt: Date.now(), error: String(e.message || e) });
    return false;
  }
}

async function freqLookup(msg) {
  const forms = (msg.forms || []).slice(0, 6);
  const out = {};
  for (const src of Object.keys(FREQ_SOURCES)) {
    if (!(await ensureFreq(src))) continue;
    const ids = new Set();
    forms.forEach((f) => { ids.add(bucketOf(C.normKey(f.word || f.reading || ''))); });
    const data = await chrome.storage.local.get(Array.from(ids, (i) => 'freq:' + src + ':' + i));
    let best = null;
    for (const f of forms) {
      const k = C.normKey(f.word || f.reading || '');
      const b = data['freq:' + src + ':' + bucketOf(k)] || {};
      const rd = f.reading ? C.kataToHira(f.reading) : '';
      const rank = (rd && b[k + '|' + rd]) || b[k];
      if (rank && (best == null || rank < best)) best = rank;
    }
    if (best != null) out[src] = { rank: best, label: FREQ_SOURCES[src].label };
  }
  return { freq: out };
}

// --------------------------------------------------------------------- audio
async function audioFetch(msg) {
  const word = String(msg.word || '').trim();
  const reading = String(msg.reading || '').trim();
  if (!word && !reading) throw new Error('Nothing to play');
  const key = 'au:' + word + '|' + reading;
  const hit = memGet(key, HOUR);
  if (hit) {
    if (hit.fail) throw new Error('no-audio');
    return hit;
  }
  try {
    const params = new URLSearchParams();
    if (word && reading && word !== reading) { params.set('kanji', word); params.set('kana', reading); }
    else params.set('kana', reading || word);
    const res = await fetchResp('https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?' + params.toString(), {}, 6000);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 3000 || (await sha256hex(buf)) === INVALID_AUDIO_SHA256) throw new Error('no-audio');
    return memSet(key, { b64: toBase64(buf), mime: 'audio/mpeg' });
  } catch (e) {
    memSet(key, { fail: true });
    throw e;
  }
}

// ------------------------------------------------------------- card pictures
// A friendly anime GIF for the back of a flashcard. nekos.best is the main source (it also names the anime a clip
// comes from); waifu.pics is the back-up. Which category to ask for is decided in core.js, which only ever
// picks wholesome ones, so nothing awkward can come back. A few clips per category are kept so swapping is instant.
const PIC_TTL = 7 * 24 * HOUR;
const NEKOS_API = 'https://nekos.best/api/v2/';
const WAIFU_API = 'https://api.waifu.pics/';
const PIC_HOST = /^https:\/\/(nekos\.best|i\.waifu\.pics)\//; // only ever hand out images from these two
const PIC_SOURCES = {
  nekos: { name: 'nekos.best', url: 'https://nekos.best' },
  waifu: { name: 'waifu.pics', url: 'https://waifu.pics' }
};
const WAIFU_CATS = { // our category -> the same idea on waifu.pics (the ones it has)
  nom: 'nom', cry: 'cry', blush: 'blush', smile: 'smile', happy: 'happy', wave: 'wave', highfive: 'highfive',
  handhold: 'handhold', dance: 'dance', pat: 'pat', smug: 'smug', hug: 'hug', poke: 'poke', wink: 'wink', facepalm: 'cringe'
};
let nekosDownUntil = 0;

// An HTTP 4xx (other than 429) means "that category isn't there"; anything else means the site itself is in trouble.
const siteTrouble = (e) => !(e && (e.code === 'empty' || (e.status >= 400 && e.status < 500 && e.status !== 429)));

async function picturePool(provider, cat) {
  const key = 'picpool:' + provider + ':' + cat;
  const hit = memGet(key, 6 * HOUR);
  if (hit) return hit;
  return once(key, async () => {
    const stored = (await chrome.storage.local.get(key))[key];
    if (stored && Array.isArray(stored.items) && stored.items.length && Date.now() - stored.t < PIC_TTL) return memSet(key, stored.items);
    let items = [];
    if (provider === 'nekos') {
      const res = await fetchResp(NEKOS_API + encodeURIComponent(cat) + '?amount=20', {}, 8000);
      const data = await res.json();
      items = ((data && data.results) || [])
        .filter((r) => r && PIC_HOST.test(r.url || ''))
        .map((r) => ({ url: r.url, anime: String(r.anime_name || '').slice(0, 120) }));
    } else {
      const res = await fetchResp(WAIFU_API + 'many/sfw/' + encodeURIComponent(cat), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exclude: [] })
      }, 8000);
      const data = await res.json();
      items = ((data && data.files) || []).filter((u) => PIC_HOST.test(u || '')).map((u) => ({ url: u, anime: '' }));
    }
    if (!items.length) throw coded('empty', 'No pictures in ' + provider + '/' + cat);
    await chrome.storage.local.set({ [key]: { t: Date.now(), items } });
    return memSet(key, items);
  });
}

async function pictureFetch(msg) {
  const word = String(msg.word || '');
  const wanted = typeof msg.category === 'string' ? msg.category.replace(/[^a-z]/g, '') : '';
  const blocked = (await chrome.storage.local.get('pictureBlocklist')).pictureBlocklist;
  const avoid = new Set([].concat(Array.isArray(blocked) ? blocked : [], Array.isArray(msg.exclude) ? msg.exclude : []));
  const pick = (items) => {
    const fresh = items.filter((i) => !avoid.has(i.url));
    return fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
  };
  const result = (provider, cat, item) => ({
    media: {
      url: item.url, kind: /\.gif(\?|#|$)/i.test(item.url) ? 'gif' : 'image', anime: item.anime || '',
      provider: PIC_SOURCES[provider].name, providerUrl: PIC_SOURCES[provider].url, category: cat
    }
  });
  // the clip that fits the word first, then calm, friendly back-ups
  const order = (wanted ? [wanted] : []).concat(C.pictureNeutral(word).filter((c) => c !== wanted));

  if (Date.now() >= nekosDownUntil) {
    for (const cat of order.slice(0, 3)) {
      try {
        const item = pick(await picturePool('nekos', cat));
        if (item) return result('nekos', cat, item);
      } catch (e) {
        if (siteTrouble(e)) { nekosDownUntil = Date.now() + 2 * 60 * 1000; break; }
      }
    }
  }
  const waifuOrder = Array.from(new Set(order.map((c) => WAIFU_CATS[c]).filter(Boolean)));
  for (const cat of waifuOrder.slice(0, 2)) {
    try {
      const item = pick(await picturePool('waifu', cat));
      if (item) return result('waifu', cat, item);
    } catch (e) {
      if (siteTrouble(e)) break;
    }
  }
  throw coded('no-picture', 'No picture available right now');
}

// ------------------------------------------------------------------- routing
const HANDLERS = {
  JISHO_LOOKUP: async (m) => ({ data: { data: await jishoRaw(String(m.word || '').trim()) } }), // legacy
  SMART_LOOKUP: smartLookup,
  TRANSLATE_JA_EN: async (m) => ({ translated: await translateJaEn(m.text) }),
  AI_STATUS: aiStatus,
  AI_CONTEXT: aiContext,
  KANJI_LOOKUP: kanjiLookup,
  EXAMPLES_LOOKUP: examplesLookup,
  PITCH_LOOKUP: pitchLookup,
  FREQ_LOOKUP: freqLookup,
  AUDIO_FETCH: audioFetch,
  PICTURE_FETCH: pictureFetch,
  PREFETCH_DATA: async () => {
    ensurePitch().then(() => ensureFreq('wikipedia')).then(() => ensureFreq('novels')).catch(() => {});
    return {};
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const handler = HANDLERS[msg && msg.type];
      if (!handler) { sendResponse({ ok: false, error: 'Unknown message type' }); return; }
      sendResponse({ ok: true, ...(await handler(msg, sender)) });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err), code: err && err.code });
    }
  })();
  return true; // keep the channel open for async work
});

// Fetch the pitch-accent and frequency lists once, in the background, after install/update.
chrome.runtime.onInstalled.addListener(() => {
  ensurePitch().then(() => ensureFreq('wikipedia')).then(() => ensureFreq('novels')).catch(() => {});
});
