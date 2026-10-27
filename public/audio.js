// Nihon Go - audio.js
// Pronunciation for the page popup and the flashcards.
//  * words are spoken from their kana READING (so a kanji is never mis-read by the voice engine)
//  * native recordings (JapanesePod101) are tried first for single words, text-to-speech is the fallback
//  * sentences use TTS, with the clicked word swapped for its reading
(function (global) {
  'use strict';
  const NC = global.NihonCore;
  let voices = [];
  let ctx = null;
  let currentSource = null;
  let token = 0;

  function loadVoices() {
    try { voices = (global.speechSynthesis && global.speechSynthesis.getVoices()) || []; } catch (e) { voices = []; }
  }
  loadVoices();
  try { if (global.speechSynthesis) global.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* ignore */ }

  function voiceScore(v) {
    const n = v.name || '';
    let s = 0;
    if (/natural|neural|enhanced|premium/i.test(n)) s += 5;
    if (/google/i.test(n)) s += 3;
    if (/kyoko|otoya|o-ren|hattori|nanami|keita|haruka|ayumi/i.test(n)) s += 2;
    if (v.localService) s += 1;
    return s;
  }
  function pickVoice() {
    const ja = voices.filter((v) => /^ja([-_]|$)/i.test(v.lang || ''));
    ja.sort((a, b) => voiceScore(b) - voiceScore(a));
    return ja[0] || null;
  }
  function hasVoice() { loadVoices(); return !!pickVoice(); }

  // Must run synchronously inside the click handler so the browser allows sound afterwards.
  function prime() {
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (AC) {
        ctx = ctx || new AC();
        if (ctx.state === 'suspended') ctx.resume();
      }
    } catch (e) { /* ignore */ }
  }

  function stop() {
    token++;
    try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    try { if (currentSource) currentSource.stop(); } catch (e) { /* ignore */ }
    currentSource = null;
  }

  function speakTTS(text, rate, myToken) {
    return new Promise((resolve, reject) => {
      const synth = global.speechSynthesis;
      if (!synth || typeof global.SpeechSynthesisUtterance === 'undefined') {
        reject(new Error('This browser has no speech synthesis'));
        return;
      }
      loadVoices();
      const u = new global.SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = (v && v.lang) || 'ja-JP';
      u.rate = (rate || 1) * 1.05; // slightly faster default rate
      u.pitch = 1.15; // tuned up slightly for lively crisp tone
      u.volume = 1.0;
      u.onend = () => resolve('tts');
      u.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted' || myToken !== token) resolve('tts');
        else reject(new Error(e.error || 'speech failed'));
      };
      synth.speak(u);
    });
  }

  async function playBase64(b64, myToken) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) {
      const a = new Audio('data:audio/mpeg;base64,' + b64);
      await a.play();
      return;
    }
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
    if (myToken !== token) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    currentSource = src;
    await new Promise((resolve) => { src.onended = resolve; src.start(); });
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        global.chrome.runtime.sendMessage(msg, (r) => resolve(global.chrome.runtime.lastError ? null : r));
      } catch (e) { resolve(null); }
    });
  }

  async function nativeEnabled() {
    try {
      const s = await global.chrome.storage.local.get('nativeAudio');
      return s.nativeAudio !== false;
    } catch (e) { return true; }
  }

  // Speak one word. Resolves with 'native' or 'tts'.
  async function playWord(opts) {
    prime();
    stop();
    const my = token;
    const word = (opts && opts.word) || '';
    const reading = (opts && opts.reading) || '';
    const rate = (opts && opts.rate) || 1;
    if (rate >= 1 && !(opts && opts.native === false) && (await nativeEnabled())) {
      const r = await sendMessage({ type: 'AUDIO_FETCH', word, reading });
      if (my !== token) return 'cancelled';
      if (r && r.ok && r.b64) {
        try { await playBase64(r.b64, my); return 'native'; } catch (e) { /* fall back to TTS */ }
      }
    }
    if (my !== token) return 'cancelled';
    return speakTTS(reading || word, rate, my);
  }

  // Speak a sentence (TTS). `surface` + `reading` fix the pronunciation of the clicked word.
  async function playSentence(opts) {
    prime();
    stop();
    const my = token;
    const text = NC.ttsSentence(opts.sentence, opts.surface, opts.reading);
    return speakTTS(text, (opts && opts.rate) || 1, my);
  }

  global.NihonAudio = { prime, stop, playWord, playSentence, hasVoice };
  global.SwiftLangAudio = global.NihonAudio;
})(typeof window !== 'undefined' ? window : self);
