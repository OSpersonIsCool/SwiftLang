// Nihon Go - core.js
// Pure helpers shared by the background worker, the content script and the flashcard page.
// No DOM and no chrome.* calls in here, so everything can be unit-tested in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.NihonCore = api;
    root.SwiftLangCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- scripts
  const KANJI_ANY = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u3006]/;
  const KANJI_REAL = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

  const isKanji = (ch) => KANJI_ANY.test(ch);
  const hasKanji = (s) => KANJI_ANY.test(String(s || ''));
  const isKanaOnly = (s) => !!s && /^[\u3040-\u309f\u30a0-\u30ffー]+$/.test(s);
  const kataToHira = (s) =>
    String(s || '').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const hiraToKata = (s) =>
    String(s || '').replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const normKey = (s) => String(s || '').normalize('NFKC').trim();
  const sameKana = (a, b) => kataToHira(a || '') === kataToHira(b || '');
  const kanjiOf = (s) => Array.from(new Set(String(s || '').match(KANJI_REAL) || []));

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ------------------------------------------------------------ mora / pitch
  const SMALL_KANA = 'ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ';

  function splitMora(reading) {
    const out = [];
    for (const ch of Array.from(String(reading || ''))) {
      if (SMALL_KANA.includes(ch) && out.length) out[out.length - 1] += ch;
      else out.push(ch);
    }
    return out;
  }

  // n = position of the pitch drop (0 = heiban, 1 = atamadaka, ...)
  function pitchPattern(reading, n) {
    const morae = splitMora(reading);
    const len = morae.length;
    const drop = Math.max(0, Math.min(Number(n) || 0, len));
    const heights = morae.map((_, i) => {
      if (drop === 0) return i === 0 ? 0 : 1;      // low-high-high...
      if (drop === 1) return i === 0 ? 1 : 0;      // high-low-low...
      return i === 0 ? 0 : i < drop ? 1 : 0;       // low-high..high-low..
    });
    let type = 'nakadaka';
    if (drop === 0) type = 'heiban';
    else if (drop === 1) type = 'atamadaka';
    else if (drop === len) type = 'odaka';
    return { morae, heights, drop, dropAfter: drop > 0 ? drop - 1 : null, type };
  }

  // kanjium style: "0", "0,3", "(副)0,(名)3"
  function parseAccentField(field) {
    const out = [];
    for (const part of String(field || '').split(',')) {
      const m = part.trim().match(/^(?:\(([^)]*)\))?(\d+)$/);
      if (m) out.push({ n: Number(m[2]), note: m[1] || null });
    }
    return out;
  }

  // ----------------------------------------------------------------- furigana
  // Split a word into [{t, r}] where r (hiragana) is the ruby for t, or null for plain kana.
  function alignFurigana(word, reading) {
    word = String(word || '');
    if (!word) return [];
    if (!reading || !hasKanji(word)) return [{ t: word, r: null }];
    const rd = kataToHira(reading);
    if (kataToHira(word) === rd) return [{ t: word, r: null }];

    const runs = [];
    for (const ch of Array.from(word)) {
      const k = isKanji(ch);
      const last = runs[runs.length - 1];
      if (last && last.kanji === k) last.t += ch;
      else runs.push({ t: ch, kanji: k });
    }

    function solve(ri, pos) {
      if (ri === runs.length) return pos === rd.length ? [] : null;
      const run = runs[ri];
      if (!run.kanji) {
        const kh = kataToHira(run.t);
        if (!rd.startsWith(kh, pos)) return null;
        const rest = solve(ri + 1, pos + kh.length);
        return rest ? [{ t: run.t, r: null }, ...rest] : null;
      }
      for (let len = 1; pos + len <= rd.length; len++) {
        const rest = solve(ri + 1, pos + len);
        if (rest) return [{ t: run.t, r: rd.slice(pos, pos + len) }, ...rest];
      }
      return null;
    }
    return solve(0, 0) || [{ t: word, r: rd }];
  }

  // "彼[かれ]は 日本語[にほんご]が" (Tatoeba) -> segments
  function parseFuriganaBracket(text) {
    const segs = [];
    const re = /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u3006]+)\[([^\]]+)\]/g;
    let last = 0, m;
    const pushPlain = (s) => { s = s.replace(/\s+/g, ''); if (s) segs.push({ t: s, r: null }); };
    while ((m = re.exec(text))) {
      pushPlain(text.slice(last, m.index));
      segs.push({ t: m[1], r: kataToHira(m[2]) });
      last = m.index + m[0].length;
    }
    pushPlain(text.slice(last));
    return segs;
  }

  // <ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby> -> segments
  function parseRubyHTML(html) {
    const segs = [];
    const re = /<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt>[\s\S]*?<\/ruby>/gi;
    const strip = (s) => s.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, '');
    let last = 0, m;
    while ((m = re.exec(html))) {
      const before = strip(html.slice(last, m.index));
      if (before) segs.push({ t: before, r: null });
      const base = strip(m[1].replace(/<rp>[\s\S]*?<\/rp>/gi, ''));
      const rt = strip(m[2]);
      if (base) segs.push({ t: base, r: rt ? kataToHira(rt) : null });
      last = m.index + m[0].length;
    }
    const tail = strip(html.slice(last));
    if (tail) segs.push({ t: tail, r: null });
    return segs;
  }

  function segsText(segs) { return segs.map((s) => s.t).join(''); }

  // mark the segments that overlap the first occurrence of any needle
  function markSegments(segs, needles) {
    const plain = segsText(segs);
    let start = -1, end = -1;
    for (const n of needles || []) {
      if (!n) continue;
      const i = plain.indexOf(n);
      if (i >= 0 && (start < 0 || i < start)) { start = i; end = i + n.length; }
    }
    if (start < 0) return segs.map((s) => ({ ...s, mark: false }));
    let pos = 0;
    return segs.map((s) => {
      const a = pos, b = pos + s.t.length;
      pos = b;
      return { ...s, mark: a < end && b > start };
    });
  }

  function rubyHTML(segs) {
    let html = '', open = false;
    for (const s of segs) {
      if (s.mark && !open) { html += '<mark>'; open = true; }
      if (!s.mark && open) { html += '</mark>'; open = false; }
      html += s.r
        ? `<ruby>${escapeHTML(s.t)}<rp>(</rp><rt>${escapeHTML(s.r)}</rt><rp>)</rp></ruby>`
        : escapeHTML(s.t);
    }
    return open ? html + '</mark>' : html;
  }

  function highlightText(text, start, len) {
    text = String(text || '');
    if (start == null || start < 0 || len <= 0 || start + len > text.length) return escapeHTML(text);
    return escapeHTML(text.slice(0, start)) + '<mark>' + escapeHTML(text.slice(start, start + len)) + '</mark>' +
      escapeHTML(text.slice(start + len));
  }

  // --------------------------------------------------- word classes / forms
  const ENDING_MAP = { u: 'う', ku: 'く', gu: 'ぐ', su: 'す', tsu: 'つ', nu: 'ぬ', bu: 'ぶ', mu: 'む', ru: 'る' };

  function classifyEntry(posList) {
    const kinds = [];
    const add = (k) => { if (!kinds.some((x) => JSON.stringify(x) === JSON.stringify(k))) kinds.push(k); };
    for (const raw of posList || []) {
      const l = String(raw).toLowerCase();
      if (/ichidan verb/.test(l)) add({ k: 'v1' });
      else if (/godan verb/.test(l)) {
        const m = l.match(/'(\w+)' ending/);
        if (/iku\/yuku/.test(l)) add({ k: 'v5', end: 'く', iku: true });
        else if (/-aru special/.test(l)) add({ k: 'v5', end: 'る', aruSpecial: true });
        else if (/irregular verb/.test(l) && m && m[1] === 'ru') add({ k: 'v5', end: 'る', aru: true });
        else if (m && ENDING_MAP[m[1]]) add({ k: 'v5', end: ENDING_MAP[m[1]] });
      } else if (/kuru verb/.test(l)) add({ k: 'vk' });
      else if (/suru verb/.test(l)) add(/included|special/.test(l) ? { k: 'vs-i' } : { k: 'vs' });
      else if (/na-adjective|keiyodoshi/.test(l)) add({ k: 'adj-na' });
      else if (/i-adjective|adjective \(keiyoushi\)/.test(l)) add({ k: 'adj-i', ii: /yoi\/ii/.test(l) });
    }
    return kinds;
  }

  const GODAN = {
    'う': { a: 'わ', i: 'い', e: 'え', o: 'お', te: 'って', ta: 'った' },
    'く': { a: 'か', i: 'き', e: 'け', o: 'こ', te: 'いて', ta: 'いた' },
    'ぐ': { a: 'が', i: 'ぎ', e: 'げ', o: 'ご', te: 'いで', ta: 'いだ' },
    'す': { a: 'さ', i: 'し', e: 'せ', o: 'そ', te: 'して', ta: 'した' },
    'つ': { a: 'た', i: 'ち', e: 'て', o: 'と', te: 'って', ta: 'った' },
    'ぬ': { a: 'な', i: 'に', e: 'ね', o: 'の', te: 'んで', ta: 'んだ' },
    'ぶ': { a: 'ば', i: 'び', e: 'べ', o: 'ぼ', te: 'んで', ta: 'んだ' },
    'む': { a: 'ま', i: 'み', e: 'め', o: 'も', te: 'んで', ta: 'んだ' },
    'る': { a: 'ら', i: 'り', e: 'れ', o: 'ろ', te: 'って', ta: 'った' }
  };
  const V1 = { k: 'v1' };

  function baseStems(word, kind) {
    if (kind.k === 'v1') {
      if (!word.endsWith('る')) return null;
      const x = word.slice(0, -1);
      return {
        i: x, a: x, ba: x + 'れば', vol: x + 'よう', imp: [x + 'ろ', x + 'よ'], te: x + 'て', ta: x + 'た',
        pot: [x + 'られる', x + 'れる'], pass: [x + 'られる'], caus: [x + 'させる'], causPass: [x + 'させられる']
      };
    }
    if (kind.k === 'v5') {
      const last = word.slice(-1), x = word.slice(0, -1), t = GODAN[last];
      if (!t || (kind.end && kind.end !== last)) return null;
      let a = x + t.a;
      if (kind.aru && x.endsWith('あ')) a = x.slice(0, -1);          // ある -> ない
      return {
        i: kind.aruSpecial ? x + 'い' : x + t.i, a,
        ba: x + t.e + 'ば', vol: x + t.o + 'う', imp: [kind.aruSpecial ? x + 'い' : x + t.e],
        te: kind.iku ? x + 'って' : x + t.te, ta: kind.iku ? x + 'った' : x + t.ta,
        pot: [x + t.e + 'る'], pass: [x + t.a + 'れる'], caus: [x + t.a + 'せる'],
        causPass: [x + t.a + 'せられる', x + t.a + 'される']
      };
    }
    if (kind.k === 'vs-i') {
      if (!/(す|ず)る$/.test(word)) return null;
      const x = word.slice(0, -2);
      return {
        i: x + 'し', a: x + 'し', ba: x + 'すれば', vol: x + 'しよう', imp: [x + 'しろ', x + 'せよ'],
        te: x + 'して', ta: x + 'した', pot: [x + 'できる', x + 'せる'], pass: [x + 'される'],
        caus: [x + 'させる'], causPass: [x + 'させられる']
      };
    }
    if (kind.k === 'vk') {
      const kanji = word.endsWith('来る');
      if (!kanji && !word.endsWith('くる')) return null;
      const x = word.slice(0, -2);
      const I = kanji ? '来' : 'き', A = kanji ? '来' : 'こ', E = kanji ? '来' : 'く';
      return {
        i: x + I, a: x + A, ba: x + E + 'れば', vol: x + A + 'よう', imp: [x + A + 'い'], te: x + I + 'て', ta: x + I + 'た',
        pot: [x + A + 'られる'], pass: [x + A + 'られる'], caus: [x + A + 'させる'], causPass: [x + A + 'させられる']
      };
    }
    return null;
  }

  // Every conjugated form of `word` we care about, as Map<form, labels[]>
  function conjugateAll(word, kind) {
    const out = new Map();
    const add = (form, labels) => { if (form && !out.has(form)) out.set(form, labels); };

    function genAdj(w, k, prefix, depth) {
      if (!w.endsWith('い')) return;
      const P = (...l) => prefix.concat(l);
      const x = k.ii && w.endsWith('いい') ? w.slice(0, -2) + 'よ' : w.slice(0, -1);
      add(w, prefix);
      add(x + 'く', P('adverbial (-ku)'));
      add(x + 'くて', P('te-form'));
      add(x + 'くない', P('negative'));
      add(x + 'くなかった', P('negative', 'past'));
      add(x + 'くなくて', P('negative', 'te-form'));
      add(x + 'かった', P('past'));
      add(x + 'かったら', P('conditional (-tara)'));
      add(x + 'ければ', P('conditional (-ba)'));
      add(x + 'くなければ', P('negative', 'conditional (-ba)'));
      add(x + 'さ', P('noun (-sa)'));
      add(x + 'そう', P('appearance (-sou)'));
      add(x + 'かろう', P('volitional (-karou)'));
      add(x + 'くありません', P('polite', 'negative'));
      add(x + 'くありませんでした', P('polite', 'past', 'negative'));
      if (depth === 0) gen(x + 'すぎる', V1, P('too much (-sugiru)'), depth + 1);
    }

    function genAux(te, kind0, prefix, depth) {
      const voiced = te.endsWith('で');
      const ctr = te.slice(0, -1);
      const aux = [
        [te + 'いる', V1, 'progressive (-te iru)', true],
        [te + 'る', V1, 'progressive (-teru)', true],
        [te + 'しまう', { k: 'v5', end: 'う' }, 'completed (-te shimau)', true],
        [ctr + (voiced ? 'じゃう' : 'ちゃう'), { k: 'v5', end: 'う' }, 'completed (-chau)', true],
        [te + 'おく', { k: 'v5', end: 'く' }, 'in advance (-te oku)', false],
        [ctr + (voiced ? 'どく' : 'とく'), { k: 'v5', end: 'く' }, 'in advance (-toku)', false],
        [te + 'みる', V1, 'try (-te miru)', false],
        [te + 'くる', { k: 'vk' }, '-te kuru', false],
        [te + 'いく', { k: 'v5', end: 'く', iku: true }, '-te iku', false],
        [te + 'ある', { k: 'v5', end: 'る', aru: true }, 'resultant state (-te aru)', false],
        [te + 'あげる', V1, 'do for someone (-te ageru)', false],
        [te + 'くれる', V1, 'someone does for you (-te kureru)', false],
        [te + 'もらう', { k: 'v5', end: 'う' }, 'have done for you (-te morau)', false]
      ];
      for (const [w, k, label, deep] of aux) {
        if (depth >= 1 && !deep) continue;
        gen(w, k, prefix.concat(label), depth + 1);
      }
      add(te + 'ください', prefix.concat('request (-te kudasai)'));
      genAdj(te + 'ほしい', { k: 'adj-i' }, prefix.concat('wish (-te hoshii)'), depth + 1);
    }

    function gen(w, k, prefix, depth) {
      if (depth > 2) return;
      if (k.k === 'adj-i') return genAdj(w, k, prefix, depth);
      const b = baseStems(w, k);
      if (!b) return;
      const P = (...l) => prefix.concat(l);
      add(w, prefix);
      add(b.i, P('masu-stem'));
      add(b.i + 'ます', P('polite'));
      add(b.i + 'ません', P('polite', 'negative'));
      add(b.i + 'ました', P('polite', 'past'));
      add(b.i + 'ませんでした', P('polite', 'past', 'negative'));
      add(b.i + 'ましょう', P('polite', 'volitional'));
      add(b.i + 'まして', P('polite', 'te-form'));
      add(b.a + 'ない', P('negative'));
      add(b.a + 'なかった', P('negative', 'past'));
      add(b.a + 'なくて', P('negative', 'te-form'));
      add(b.a + 'ないで', P('negative', '-naide'));
      add(b.a + 'なければ', P('negative', 'conditional (-ba)'));
      add(b.a + 'なかったら', P('negative', 'conditional (-tara)'));
      add(b.a + 'なきゃ', P('negative', 'colloquial -nakya'));
      add(b.a + 'ず', P('negative (-zu)'));
      add(b.te, P('te-form'));
      add(b.ta, P('past'));
      add(b.ta + 'ら', P('conditional (-tara)'));
      add(b.ta + 'り', P('-tari'));
      add(b.ba, P('conditional (-ba)'));
      add(b.vol, P('volitional'));
      for (const f of b.imp) add(f, P('imperative'));
      add(b.i + 'なさい', P('polite command (-nasai)'));
      add(b.i + 'ながら', P('while (-nagara)'));
      add(b.i + 'そう', P('appearance (-sou)'));
      if (depth === 0) {
        for (const f of b.pot) gen(f, V1, P('potential'), depth + 1);
        for (const f of b.pass) gen(f, V1, P('passive'), depth + 1);
        for (const f of b.caus) gen(f, V1, P('causative'), depth + 1);
        for (const f of b.causPass) gen(f, V1, P('causative-passive'), depth + 1);
        genAdj(b.i + 'たい', { k: 'adj-i' }, P('desire (-tai)'), depth + 1);
        genAdj(b.i + 'やすい', { k: 'adj-i' }, P('easy to (-yasui)'), depth + 1);
        genAdj(b.i + 'にくい', { k: 'adj-i' }, P('hard to (-nikui)'), depth + 1);
        gen(b.i + 'すぎる', V1, P('too much (-sugiru)'), depth + 1);
      }
      if (depth <= 1) genAux(b.te, k, prefix, depth);
    }

    gen(word, kind, [], 0);
    return out;
  }

  const conjCache = new Map();
  function cachedConj(word, kind) {
    const key = word + '|' + JSON.stringify(kind);
    if (conjCache.has(key)) return conjCache.get(key);
    const m = conjugateAll(word, kind);
    conjCache.set(key, m);
    if (conjCache.size > 60) conjCache.delete(conjCache.keys().next().value);
    return m;
  }

  // Is `surface` a (possibly conjugated) form of this entry?  -> {labels, base} | null
  function matchInflection(surface, entry) {
    if (!surface || !entry) return null;
    if (surface === entry.word || (entry.reading && sameKana(surface, entry.reading))) return { labels: [], base: entry.word };
    const kinds = classifyEntry(entry.pos || []);
    const bases = [entry.word, entry.reading].filter(Boolean);
    for (const base of bases) {
      for (const kind of kinds) {
        let w = base, k = kind;
        if (kind.k === 'vs') { w = base + 'する'; k = { k: 'vs-i' }; }
        const labels = cachedConj(w, k).get(surface);
        if (labels) return { labels, base: w };
      }
    }
    return null;
  }

  // ------------------------------------------------------------ names, ranking
  const HONORIFICS = ['さん', 'ちゃん', 'くん', '君', '様', 'さま', '氏', '殿', 'どの'];
  const NAME_POS_RE = /\bname\b|surname|forename|proper noun|railway station/i;

  // nextToken: the token right after the matched span. A name needs kanji, katakana or 3+ kana.
  function detectName(nextToken, surface) {
    const tok = String(nextToken || '').trim();
    const s = String(surface || '');
    const nameShaped = hasKanji(s) || /^[\u30a0-\u30ffー]{2,}$/.test(s) || (isKanaOnly(s) && s.length >= 3);
    if (nameShaped && HONORIFICS.includes(tok)) return { likely: true, reason: 'followed by ' + tok };
    return { likely: false, reason: '' };
  }
  // "茸さん" -> { stem: '茸', honorific: 'さん' } when the stem looks like a name; otherwise null
  function splitHonorific(token) {
    token = String(token || '');
    for (const h of HONORIFICS) {
      if (token.length > h.length && token.endsWith(h)) {
        const stem = token.slice(0, -h.length);
        if (detectName(h, stem).likely) return { stem, honorific: h };
      }
    }
    return null;
  }
  const isNamePOS = (p) => NAME_POS_RE.test(String(p || ''));

  const STOP = new Set(('the and for with from that this these those into onto over under about have has had was were are been being ' +
    'one ones someone something somebody oneself ones not than then very more most also any all its their there here what which who ' +
    'etc such use used using make made kind sort type way thing things').split(' '));
  const stemEn = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|ly|s)$/, '') : w);
  function engTokens(s) {
    return String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)).map(stemEn);
  }
  function tokensOverlap(a, b) {
    if (a === b) return true;
    const min = Math.min(a.length, b.length);
    return min >= 4 && (a.startsWith(b) || b.startsWith(a));
  }

  // Score each sense of `entry` against the sentence translation and name hints.
  function scoreSenses(entry, ctx) {
    ctx = ctx || {};
    const tset = engTokens(ctx.translation || '');
    const scores = [];
    let evidence = false;
    (entry.senses || []).forEach((s, i) => {
      let score = -0.15 * i;
      let hit = 0;
      for (const d of s.defs || []) {
        for (const tok of engTokens(d)) if (tset.some((t) => tokensOverlap(t, tok))) hit++;
      }
      if (hit) { score += 2 + 0.5 * (hit - 1); evidence = true; }
      const namey = (s.posAll || s.pos || []).some(isNamePOS);
      if (ctx.likelyName) { score += namey ? 4 : -1; if (namey) evidence = true; }
      if (s.wiki) score -= 1.5;
      scores.push(score);
    });
    let best = -1;
    scores.forEach((v, i) => { if (best < 0 || v > scores[best]) best = i; });
    const sorted = scores.slice().sort((a, b) => b - a);
    const confident = evidence && best >= 0 && (sorted.length < 2 || sorted[0] - sorted[1] >= 1.2);
    return { scores, best, confident };
  }

  const norm = (s) => kataToHira(String(s || ''));
  function rankEntries(entries, surface, ctx) {
    ctx = ctx || {};
    const scored = entries.map((e, idx) => {
      let score = -0.05 * idx;
      const forms = e.forms || [];
      if (forms.some((f) => f.word === surface)) score += 6;
      else if (forms.some((f) => norm(f.reading) === norm(surface))) score += 4;
      if (e.isCommon) score += 2;
      if (e.jlpt && e.jlpt.length) score += 0.5;
      if (e.isName) score += ctx.likelyName ? 5 : -2;
      if (e.senses.length && e.senses.every((s) => s.wiki)) score -= 3;
      const ss = scoreSenses(e, ctx);
      if (ss.best >= 0) score += Math.max(0, ss.scores[ss.best]) * 0.5;
      return { e, score, idx };
    });
    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
    return scored.map((x) => x.e);
  }

  // ----------------------------------------------------------- jisho + others
  function normalizeJisho(raw) {
    const jp = Array.isArray(raw.japanese) ? raw.japanese : [];
    const forms = jp.map((j) => ({ word: j.word || null, reading: j.reading || null }));
    const first = forms[0] || {};
    const tags = Array.isArray(raw.tags) ? raw.tags : [];
    const wk = tags.find((t) => /^wanikani\d+$/.test(t));
    let lastPos = [];
    const senses = (raw.senses || []).map((s) => {
      const own = (s.parts_of_speech || []).filter(Boolean);
      const wiki = own.includes('Wikipedia definition');
      const ownClean = own.filter((p) => p !== 'Wikipedia definition');
      if (ownClean.length) lastPos = ownClean;
      return {
        pos: ownClean, posAll: lastPos.slice(), wiki,
        defs: s.english_definitions || [], tags: s.tags || [], info: s.info || [],
        restrictions: s.restrictions || [], seeAlso: s.see_also || [], antonyms: s.antonyms || [],
        links: s.links || [], source: s.source || []
      };
    });
    const pos = Array.from(new Set(senses.flatMap((s) => s.posAll)));
    const named = senses.filter((s) => !s.wiki);
    return {
      slug: raw.slug || first.word || first.reading || '',
      word: first.word || first.reading || raw.slug || '',
      reading: first.reading || '',
      forms,
      isCommon: !!raw.is_common,
      jlpt: (raw.jlpt || []).map((x) => String(x).replace(/^jlpt-/i, '').toUpperCase()),
      wk: wk ? Number(wk.slice(8)) : null,
      tags: tags.filter((t) => !/^wanikani/.test(t)),
      senses, pos,
      isName: named.length > 0 && named.every((s) => s.posAll.length && s.posAll.every(isNamePOS)),
      attribution: raw.attribution || {}
    };
  }

  function entryMatchesSurface(entry, surface) {
    const s = norm(surface);
    return (entry.forms || []).some((f) => f.word === surface || (f.reading && norm(f.reading) === s));
  }

  function parseTatoebaItem(item) {
    if (!item || !item.text) return null;
    const trs = Array.isArray(item.translations) ? item.translations : [];
    const eng = trs.filter((t) => t && t.lang === 'eng' && t.text);
    const tr = eng.find((t) => t.is_direct) || eng[0];
    if (!tr) return null;
    let segs = null;
    const trans = Array.isArray(item.transcriptions) ? item.transcriptions : [];
    for (const t of trans) {
      if (!t || (t.script && t.script !== 'Hrkt')) continue;
      let cand = null;
      if (t.text && t.text.includes('[')) cand = parseFuriganaBracket(t.text);
      else if (t.html && /<ruby/i.test(t.html)) cand = parseRubyHTML(t.html);
      if (cand && segsText(cand).replace(/\s+/g, '') === item.text.replace(/\s+/g, '')) { segs = cand; break; }
    }
    const audio = (item.audios || []).find((a) => a && a.download_url);
    return {
      id: item.id, jp: item.text, en: tr.text, segs: segs || [{ t: item.text, r: null }],
      audio: audio ? audio.download_url : null, owner: item.owner || null
    };
  }

  function pickExamples(items, needles, limit) {
    const parsed = (items || []).map(parseTatoebaItem).filter(Boolean);
    const withScore = parsed.map((p) => {
      const has = (needles || []).some((n) => n && p.jp.includes(n));
      return { p, s: (has ? 100 : 0) - Math.min(p.jp.length, 80) + (p.segs.some((x) => x.r) ? 5 : 0) };
    });
    withScore.sort((a, b) => b.s - a.s);
    const seen = new Set();
    const out = [];
    for (const { p } of withScore) {
      if (seen.has(p.jp)) continue;
      seen.add(p.jp);
      out.push(p);
      if (out.length >= (limit || 5)) break;
    }
    return out;
  }

  // ------------------------------------------------------------------- AI glue
  function compactCandidates(entries, max) {
    return (entries || []).slice(0, max || 4).map((e, i) => ({
      i, word: e.word, reading: e.reading, common: e.isCommon || undefined,
      pos: e.pos.slice(0, 3),
      senses: e.senses.filter((s) => !s.wiki).slice(0, 8).map((s, j) =>
        j + ': ' + s.defs.slice(0, 4).join('; ') + (s.posAll.length ? ' [' + s.posAll[0] + ']' : ''))
    }));
  }

  const AI_SYSTEM = [
    'You are the dictionary engine inside a Japanese-learning browser extension.',
    'A learner clicked a word inside a sentence on a web page. Decide what that word means IN THIS SENTENCE.',
    'You get the sentence, the clicked text, the span the extension matched (it can be wrong or incomplete) and numbered JMdict candidates with numbered senses.',
    'Rules:',
    '- The dictionary candidates may not fit. If the span is a person name, nickname, handle, brand, place or other proper noun (for example 茸 in 茸さん), set isName=true and do not force a dictionary sense.',
    '- If a candidate fits, give its index in "entry" and the sense numbers that apply in "senses". If none fits, use entry -1 and an empty senses array.',
    '- "reading": hiragana reading of the dictionary form (lemma) as it is read in this sentence. For names give your best guess, or "" if unsure.',
    '- "spanReading": hiragana reading of the matched span exactly as written in the sentence, including any conjugation.',
    '- "lemma": dictionary form of the word (or the name itself).',
    '- "meaning": short English gloss of the span in context (max 12 words).',
    '- "note": one or two short sentences for a learner: why this sense and not the others, grammar or nuance, or what the name probably is. Plain text, no Markdown.',
    '- "translation": natural English translation of the whole sentence.',
    '- "inflection": short description if the span is conjugated (for example "polite past of 食べる"), otherwise "".',
    '- "confidence": "high", "medium" or "low".',
    'Reply with ONLY a JSON object with exactly these keys: entry, senses, reading, spanReading, lemma, meaning, note, translation, inflection, isName, confidence.'
  ].join('\n');

  function buildAIPrompt(p) {
    return {
      system: AI_SYSTEM,
      user: JSON.stringify({
        sentence: p.sentence, clicked: p.clicked, matchedSpan: p.surface,
        hints: p.likelyName ? { possibleName: true, reason: p.nameReason } : undefined,
        candidates: compactCandidates(p.entries, 4)
      })
    };
  }

  function parseAIResponse(text, entries) {
    if (!text) return null;
    let t = String(text).trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    let o;
    try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    let entry = Number.isInteger(o.entry) ? o.entry : -1;
    if (entry >= (entries || []).length) entry = -1;
    const nSenses = entry >= 0 ? entries[entry].senses.length : 0;
    const senses = (Array.isArray(o.senses) ? o.senses : []).filter((n) => Number.isInteger(n) && n >= 0 && n < nSenses);
    const kana = (v) => { const r = kataToHira(str(v, 40)); return /^[\u3041-\u3096ー]+$/.test(r) ? r : ''; };
    const reading = kana(o.reading);
    const spanReading = kana(o.spanReading);
    return {
      entry, senses, reading, spanReading,
      lemma: str(o.lemma, 40), meaning: str(o.meaning, 160), note: str(o.note, 400),
      translation: str(o.translation, 500), inflection: str(o.inflection, 80),
      isName: o.isName === true,
      confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'medium'
    };
  }

  // Replace the clicked word with its reading so TTS says the right thing.
  function ttsSentence(sentence, surface, reading) {
    if (!sentence) return '';
    if (!surface || !reading || !hasKanji(surface) || !sentence.includes(surface)) return sentence;
    return sentence.replace(surface, reading);
  }

  function meaningHTML(entry, pinIdx) {
    if (!entry || !entry.senses || !entry.senses.length) return '(no meanings)';
    const order = entry.senses.map((s, i) => i);
    if (pinIdx != null && pinIdx >= 0 && pinIdx < order.length) {
      order.splice(order.indexOf(pinIdx), 1);
      order.unshift(pinIdx);
    }
    return order.slice(0, 8).map((i) => {
      const s = entry.senses[i];
      const pos = s.posAll && s.posAll.length ? `<div><small>${escapeHTML(s.posAll.join(', '))}</small></div>` : '';
      const defs = s.defs.length ? `<ol>${s.defs.slice(0, 6).map((d) => `<li>${escapeHTML(d)}</li>`).join('')}</ol>` : '<div>(no defs)</div>';
      return `<div style="margin-top:10px;">${pos}${defs}</div>`;
    }).join('');
  }

  // ---------------------------------------------------------- card pictures
  // Decides which friendly anime reaction GIF (if any) suits a saved card. Deliberately conservative:
  //  * only wholesome categories exist here (no kiss / bite / lick / slap / kick / punch / shoot / tickle)
  //  * names, grammar words and heavy or adult topics get NO picture at all
  //  * a word that doesn't clearly match gets a calm, neutral GIF instead of a forced, odd fit
  const PICTURE_RULES = [
    ['nom', 'eat eats ate eaten eating meal meals food lunch dinner breakfast supper snack snacks sweets candy cake dessert ramen noodle noodles sushi bread rice curry dumpling dumplings bento tempura delicious tasty yummy hungry hunger appetite'],
    ['sleep', 'sleep sleeps slept sleeping sleepy asleep nap naps napping bed bedtime doze drowsy snore snoring futon pillow slumber'],
    ['yawn', 'yawn yawns yawning tired tire tires tiredness weary exhausted exhaustion fatigue fatigued'],
    ['bored', 'bored boring boredom dull tedious monotonous'],
    ['run', 'run runs ran running runner jog jogging dash sprint hurry hurried rush rushing marathon flee escape'],
    ['dance', 'dance dances danced dancing dancer disco music song songs sing singing singer concert'],
    ['laugh', 'laugh laughs laughed laughing laughter funny humorous amusing comical joke jokes giggle hilarious comedy'],
    ['happy', 'happy happiness joy joyful delighted delight rejoice glad pleased fun enjoy enjoyable cheerful lucky fortunate'],
    ['smile', 'smile smiles smiled smiling grin pleasant'],
    ['cry', 'cry cries cried crying weep wept tears sob sad sadness sorrow sorrowful grief lament mourn miserable lonely loneliness'],
    ['think', 'think thinks thought thinking ponder consider contemplate wonder idea ideas imagine imagination study studies studying learn learning homework exam examination question problem worry worried anxious forget remember memorize recall decide decision doubt puzzle solve mind'],
    ['nod', 'nod nods nodded nodding agree agrees agreed agreement consent approve approval accept acceptance understand understands understood understanding acknowledge confirm confirmed assent yes ok okay certainly indeed'],
    ['nope', 'no nope never refuse refusal reject rejection deny denial disagree disagreement forbid forbidden prohibit prohibited prohibition impossible cannot unacceptable ban banned'],
    ['wave', 'waving hello hi greet greeting greetings goodbye farewell bye welcome meet meets parting'],
    ['thumbsup', 'good great excellent wonderful splendid superb awesome fine nice thanks thank thankful gratitude grateful recommend persevere endure effort diligent encourage bravo'],
    ['highfive', 'congratulations congratulate celebrate celebration victory win wins won winning success succeed successful achieve achievement triumph hooray yay friend friends friendship teammate team comrade buddy pal cheers'],
    ['handshake', 'handshake cooperate cooperation collaborate partner partnership alliance introduce introduction negotiate negotiation reconcile reconciliation pact treaty'],
    ['handhold', 'handhold'],
    ['hug', 'hug hugs hugging embrace embracing love loving affection comfort warmth'],
    ['pat', 'pat pats patting praise praises praised compliment pet pets console soothe head'],
    ['poke', 'poke pokes poking prod nudge'],
    ['blush', 'blush blushes blushing shy shyness bashful embarrassed embarrassing embarrassment coy timid ashamed shame'],
    ['smug', 'smug proud pride boast boasting brag conceited arrogant arrogance haughty confident confidence'],
    ['stare', 'stare stares staring stared gaze glare glaring peer glance look see watch observe'],
    ['shrug', 'shrug dunno unsure uncertain uncertainty unclear vague whatever perhaps maybe possibly probably somehow unknown'],
    ['lurk', 'lurk hide hides hid hiding hidden secret secrets secretly peek peep sneak sneaking spy stealth conceal concealed'],
    ['pout', 'pout sulk sulky angry anger annoyed annoying annoy irritated irritating grumpy displeased complain complaint grumble upset resentful'],
    ['baka', 'baka stupid stupidity idiot fool foolish foolishness silly dumb'],
    ['facepalm', 'facepalm mistake mistakes error blunder fail fails failed failure regret regretful oops trouble troubled bother disappointed disappointing disappointment disappoint dismay exasperated sigh'],
    ['wink', 'wink winks winking']
  ];
  // only when the whole definition is that one word ("no", "good"), never inside a longer phrase ("head of a company")
  const PICTURE_STRICT = new Set(['no', 'yes', 'ok', 'okay', 'good', 'great', 'fine', 'nice', 'head', 'never', 'certainly', 'indeed', 'mind', 'rice', 'hi', 'pet', 'pets', 'meet', 'meets']);
  // only as a verb ("to look"), never the noun ("a watch", "a look")
  const PICTURE_VERB = new Set(['look', 'see', 'watch', 'observe', 'tire', 'tires']);
  const PICTURE_WORDS = new Map();
  PICTURE_RULES.forEach(([cat, words]) => words.split(/\s+/).forEach((w) => { if (w && !PICTURE_WORDS.has(w)) PICTURE_WORDS.set(w, cat); }));

  const PICTURE_PHRASES = [
    [/\bgood (morning|afternoon|evening|day)\b/, 'wave'],
    [/\bgood ?night\b/, 'sleep'],
    [/\bsee you\b|\bnice to meet\b|\bpleased to meet\b|\bhow do you do\b/, 'wave'],
    [/\bwell done\b|\bgood job\b|\bdo(ing)? (one'?s|ones|your) best\b|\bhang in there\b|\btry (one'?s )?hard\b/, 'thumbsup'],
    [/\bhold(ing)? hands?\b|\bhand in hand\b/, 'handhold'],
    [/\bhigh[- ]?five\b/, 'highfive'],
    [/\bshak(e|ing) hands?\b/, 'handshake']
  ];
  const PICTURE_STOP = new Set(['to', 'be', 'a', 'an', 'the', 'one', 'ones', "one's", 'oneself', 'someone', 'something', 'somebody',
    'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'get', 'go', 'become', 'feel', 'being', 'very', 'so']);
  // topics where a cheerful cartoon would be tasteless: no picture at all
  const PICTURE_AVOID = new Set(('die dies died dying death dead deceased corpse kill kills killed killing murder suicide funeral grave cemetery ' +
    'war warfare battle weapon gun bomb explosion blood bleeding wound wounded injury injured disease illness sick sickness cancer hospital ' +
    'accident crash disaster earthquake tsunami terror terrorist crime criminal prison jail rape abuse violence violent torture tragedy tragic ' +
    'victim sex sexual erotic lewd pervert nude naked breast genitals prostitute porn obscene indecent drug drugs overdose racist racism slave slavery').split(' '));
  const PICTURE_FUNCTION_POS = /\b(particle|auxiliary|suffix|prefix|counter|conjunction|copula)\b/i;
  const PICTURE_NEUTRAL = ['think', 'smile', 'nod', 'wave', 'thumbsup', 'happy'];

  function decodeBasic(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
  }

  // The English meanings of a saved card, best first: the sense that fits the sentence, then the main senses.
  function cardGlosses(card) {
    const out = [];
    const add = (s) => { s = String(s == null ? '' : s).trim(); if (s && !out.includes(s)) out.push(s); };
    if (!card) return out;
    String(card.contextMeaning || '').split(/[;,]/).forEach(add);
    const senses = Array.isArray(card.senses) ? card.senses : [];
    const pin = Number.isInteger(card.pinSense) ? senses[card.pinSense] : null;
    if (pin) (pin.defs || []).slice(0, 4).forEach(add);
    senses.slice(0, 2).forEach((s) => ((s && s.defs) || []).slice(0, 3).forEach(add));
    if (!senses.length && card.meaningHTML) { // cards saved by older versions only have the HTML
      const re = /<li>([\s\S]*?)<\/li>/g;
      let m, n = 0;
      while ((m = re.exec(String(card.meaningHTML))) && n++ < 6) add(decodeBasic(m[1].replace(/<[^>]*>/g, '')));
    }
    return out.slice(0, 14);
  }

  function pictureTokens(def) {
    const raw = String(def || '').toLowerCase().trim();
    if (!raw || raw.includes('(')) return null; // "to run (a business)": a narrower sense, so don't illustrate it
    const tokens = raw.replace(/[^a-z' -]+/g, ' ').split(/[\s-]+/).filter((w) => w && !PICTURE_STOP.has(w));
    return tokens.length && tokens.length <= 3 ? { raw, tokens } : null;
  }

  function pictureKey(tok) {
    const t = String(tok);
    const tries = [t];
    if (t.endsWith('ies')) tries.push(t.slice(0, -3) + 'y');
    if (t.endsWith('es')) tries.push(t.slice(0, -2));
    if (t.endsWith('s')) tries.push(t.slice(0, -1));
    for (const suf of ['ing', 'ed']) {
      if (!t.endsWith(suf)) continue;
      const b = t.slice(0, -suf.length);
      tries.push(b, b + 'e');
      if (/(.)\1$/.test(b)) tries.push(b.slice(0, -1));
    }
    return tries.find((k) => PICTURE_WORDS.has(k)) || null;
  }

  // First definition that clearly names something a reaction GIF can show -> { category, keyword }, else null.
  function pictureConcept(glosses) {
    for (const def of glosses || []) {
      const p = pictureTokens(def);
      if (!p) continue;
      for (const [re, cat] of PICTURE_PHRASES) if (re.test(p.raw)) return { category: cat, keyword: p.raw };
      for (const tok of p.tokens) {
        const key = pictureKey(tok);
        if (!key) continue;
        if (PICTURE_STRICT.has(key) && p.tokens.length > 1) continue;
        if (PICTURE_VERB.has(key) && !/^to\s/.test(p.raw)) continue;
        return { category: PICTURE_WORDS.get(key), keyword: key };
      }
    }
    return null;
  }

  // -> { skip, category, keyword }. skip = "show no picture for this card".
  function picturePlan(card) {
    const skip = { skip: true, category: null, keyword: null };
    if (!card || card.isName) return skip;
    const senses = Array.isArray(card.senses) ? card.senses : [];
    const posList = Array.from(new Set(senses.flatMap((s) => (s && s.pos) || []).concat(card.pos || [])));
    if (posList.length && posList.every((p) => PICTURE_FUNCTION_POS.test(p))) return skip;
    const scan = [String(card.contextMeaning || '')];
    senses.slice(0, 3).forEach((s) => scan.push(...((s && s.defs) || [])));
    if (!senses.length) scan.push(...cardGlosses(card));
    if (scan.join(' ').toLowerCase().split(/[^a-z]+/).some((w) => PICTURE_AVOID.has(w))) return skip;
    const hit = pictureConcept(cardGlosses(card));
    return { skip: false, category: hit ? hit.category : null, keyword: hit ? hit.keyword : null };
  }

  // Calm back-up categories in a stable order per word (the same word always starts with the same one).
  function pictureNeutral(seed) {
    const h = (s) => { let x = 5381; for (const ch of String(s)) x = ((x * 33) ^ ch.codePointAt(0)) >>> 0; return x; };
    return PICTURE_NEUTRAL.map((c) => [h(seed + '|' + c), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }

  return {
    isKanji, hasKanji, isKanaOnly, kataToHira, hiraToKata, normKey, sameKana, kanjiOf, escapeHTML,
    splitMora, pitchPattern, parseAccentField,
    alignFurigana, parseFuriganaBracket, parseRubyHTML, segsText, markSegments, rubyHTML, highlightText,
    classifyEntry, conjugateAll, matchInflection,
    detectName, splitHonorific, isNamePOS, engTokens, scoreSenses, rankEntries, entryMatchesSurface,
    normalizeJisho, parseTatoebaItem, pickExamples,
    compactCandidates, buildAIPrompt, parseAIResponse, ttsSentence, meaningHTML,
    cardGlosses, pictureConcept, picturePlan, pictureNeutral
  };
});
