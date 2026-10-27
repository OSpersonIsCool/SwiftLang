// Nihon Go - content.js
// Click any Japanese word on a page for a sentence-aware popup; save it to the local SRS.
// (Page scanning / tokenising below is unchanged; the popup is a new closed-shadow-DOM UI.)

const style = document.createElement("style");
style.textContent = `
  .jp-token {
    cursor: pointer;
    padding: 0 2px;
    border-radius: 3px;
    transition: background 0.15s;
  }
  .jp-token:hover { background: #ffe14d; box-shadow: 0 2px 0 #161616; }

  @media (prefers-reduced-motion: reduce) {
    .jp-token { transition-duration: 0.01ms !important; }
  }
`;
document.documentElement.appendChild(style);

console.log("Language Overlay is running");

const IS_DISCORD = location.host.includes("discord.com");
const IS_GOOGLE = location.host.includes("google.") && location.pathname.startsWith("/search");

const hasJpChar = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/;
const jpRunRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]+/g;

const segmenter = new TinySegmenter();

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function safeSegment(text) {
  try {
    const out = segmenter.segment(text);
    return Array.isArray(out) ? out.filter(Boolean) : [text];
  } catch (e) {
    console.warn("TinySegmenter failed on:", text, e);
    return [text];
  }
}

function isForbiddenTextNode(textNode) {
  const p = textNode.parentElement;
  if (!p) return true;
  if (p.closest?.("[data-jp-original]")) return true;
  if (p.closest?.(".jp-token") || p.closest?.("#jp-popup")) return true;
  const tag = p.tagName?.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "noscript") return true;
  if (p.closest?.("code, pre")) return true;
  if (p.closest?.("input, textarea")) return true;
  if (p.closest?.("[contenteditable='true']")) {
    if (IS_DISCORD) {
      if (p.closest?.("[role='textbox']")) return true;
      if (p.closest?.("form")) return true;
      return false;
    }
    return true;
  }
  return false;
}

function wrapJapaneseTextNode(textNode) {
  const original = textNode.nodeValue;
  if (!original || !hasJpChar.test(original)) return;
  if (isForbiddenTextNode(textNode)) return;

  const container = document.createElement("span");
  container.dataset.jpOriginal = original;

  let lastIndex = 0;
  const frag = document.createDocumentFragment();

  for (const match of original.matchAll(jpRunRegex)) {
    const run = match[0];
    const runStart = match.index ?? 0;

    if (runStart > lastIndex) {
      frag.appendChild(document.createTextNode(original.slice(lastIndex, runStart)));
    }

    const runWrap = document.createElement("span");
    runWrap.dataset.jpRunStart = String(runStart);

    const tokens = safeSegment(run);
    let rel = 0;
    for (const t of tokens) {
      const tok = document.createElement("span");
      tok.className = "jp-token";
      tok.textContent = t;
      tok.dataset.tokRelStart = String(rel);
      rel += t.length;
      runWrap.appendChild(tok);
    }

    frag.appendChild(runWrap);
    lastIndex = runStart + run.length;
  }

  if (lastIndex < original.length) {
    frag.appendChild(document.createTextNode(original.slice(lastIndex)));
  }

  container.appendChild(frag);
  textNode.parentNode.replaceChild(container, textNode);
}

function walkTreeIncludingShadow(root, onTextNode) {
  if (!root) return;
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = textWalker.nextNode())) onTextNode(n);
  const elWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let el;
  while ((el = elWalker.nextNode())) {
    if (el.shadowRoot) walkTreeIncludingShadow(el.shadowRoot, onTextNode);
  }
}

function scanAndWrap(root) {
  walkTreeIncludingShadow(root, (textNode) => {
    if (!textNode.nodeValue || !textNode.nodeValue.trim()) return;
    if (!hasJpChar.test(textNode.nodeValue)) return;
    wrapJapaneseTextNode(textNode);
  });
}

function getScanRoot() {
  if (IS_DISCORD) {
    return (
      document.querySelector('[data-list-id="chat-messages"]') ||
      document.querySelector('[role="log"]') ||
      document.querySelector(".chatContent-") ||
      document.documentElement
    );
  }
  if (IS_GOOGLE) {
    return document.querySelector("#search") || document.querySelector("#rso") || document.documentElement;
  }
  return document.documentElement;
}

let scanQueued = false;
function queueRescan() {
  if (scanQueued) return;
  scanQueued = true;
  const run = () => {
    scanQueued = false;
    scanAndWrap(getScanRoot());
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 600 });
  else setTimeout(run, 60);
}

queueRescan();

let lastUrl = location.href;
function maybeUrlChanged() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    queueRescan();
  }
}
setInterval(maybeUrlChanged, 500);

(function hookHistory() {
  const _push = history.pushState;
  const _rep = history.replaceState;
  history.pushState = function (...args) {
    const r = _push.apply(this, args);
    queueRescan();
    return r;
  };
  history.replaceState = function (...args) {
    const r = _rep.apply(this, args);
    queueRescan();
    return r;
  };
  window.addEventListener("popstate", queueRescan);
  window.addEventListener("pageshow", queueRescan);
})();

const observer = new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === "characterData") {
      queueRescan();
      break;
    }
    if (m.addedNodes && m.addedNodes.length) {
      queueRescan();
      break;
    }
  }
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true
});

// =====================================================================
//  WORD POPUP  (closed shadow DOM, so page CSS can't break it)
// =====================================================================
const NC = window.NihonCore;
const NA = window.NihonAudio;
const esc = NC.escapeHTML;

const POPUP_CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  .pop {
    --ink: #161616; --paper: #fffdf7; --red: #e6302f; --yellow: #ffd83d; --green: #1f9d55;
    position: relative; width: 440px; max-width: calc(100vw - 24px); max-height: min(84vh, 720px);
    display: flex; flex-direction: column;
    background: var(--paper); color: var(--ink);
    border: 3px solid var(--ink); border-radius: 12px; box-shadow: 8px 8px 0 rgba(22,22,22,.85);
    font: 13px/1.4 "Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,system-ui,sans-serif;
    opacity: 0; transform: scale(.96) translateY(6px) rotate(-.4deg); transform-origin: var(--origin-x,50%) top;
    transition: opacity 120ms ease, transform 160ms cubic-bezier(.2,.8,.2,1);
  }
  .pop.show { opacity: 1; transform: scale(1) translateY(0) rotate(-.4deg); }
  .pop::before, .pop::after { content: ""; position: absolute; width: 0; height: 0; }
  .pop::before { top: -12px; left: calc(var(--notch-x,56px) - 12px); border-left: 12px solid transparent; border-right: 12px solid transparent; border-bottom: 12px solid var(--ink); }
  .pop::after  { top: -7px;  left: calc(var(--notch-x,56px) - 9px);  border-left: 9px solid transparent;  border-right: 9px solid transparent;  border-bottom: 9px solid var(--paper); }
  .pop.up::before { top: auto; bottom: -12px; border-bottom: 0; border-top: 12px solid var(--ink); }
  .pop.up::after  { top: auto; bottom: -7px;  border-bottom: 0; border-top: 9px solid var(--paper); }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  a { color: inherit; }

  .head { padding: 14px 0 6px; }
  .hrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .word { font-size: 34px; font-weight: 900; line-height: 1.3; letter-spacing: .5px; word-break: break-all; }
  .word rt { font-size: 12px; font-weight: 700; letter-spacing: 0; opacity: .8; }
  .hbtns { display: flex; gap: 8px; flex: 0 0 auto; }
  .play { width: 42px; height: 42px; border-radius: 10px; border: 3px solid var(--ink); background: var(--red); color: #fff;
    font-weight: 900; font-size: 15px; display: grid; place-items: center; box-shadow: 3px 3px 0 var(--ink);
    transition: transform .1s ease, box-shadow .1s ease; }
  .play.slow { background: var(--yellow); color: var(--ink); font-size: 18px; }
  .play:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--ink); }
  .play:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--ink); }
  .readline { margin-top: 2px; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px 12px; }
  .reading { font-size: 14px; font-weight: 800; }
  .dictread { font-size: 11px; opacity: .65; font-weight: 700; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .pill { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #fff; border: 2px solid var(--ink); white-space: nowrap; }
  .pill.common { background: var(--yellow); }
  .pill.lvl { background: #d7efe0; }
  .pill.freq { background: #e4e9ff; }
  .pill.ai { background: #f1dcff; }
  .pill.name { background: #ffe0dc; }
  .pill.soft { border-color: rgba(22,22,22,.4); font-weight: 600; background: transparent; }

  .pitch { display: inline-flex; align-items: flex-end; margin-right: 8px; }
  .pitch .m { padding: 1px 2px 0; border-top: 2px solid transparent; font-weight: 800; font-size: 15px; line-height: 1.2; }
  .pitch .m.h { border-top-color: var(--red); }
  .pitch .m.d { border-right: 2px solid var(--red); }
  .pitch .pn { margin-left: 4px; font-size: 10px; font-weight: 800; opacity: .6; align-self: center; }

  .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 16px 6px; overscroll-behavior: contain; }
  .scroll::-webkit-scrollbar { width: 10px; }
  .scroll::-webkit-scrollbar-track { background: var(--paper); }
  .scroll::-webkit-scrollbar-thumb { background: var(--ink); border-radius: 5px; }

  .banner { margin-top: 8px; border: 2px solid var(--ink); border-radius: 8px; padding: 8px 10px; background: #fff; }
  .banner.ai { background: #f6ecff; border-left: 6px solid #8a3ffc; }
  .banner.ctx { background: #eaf7ef; border-left: 6px solid var(--green); }
  .banner.user { background: #fff6d6; border-left: 6px solid #e0a800; }
  .banner.name { background: #ffe9e6; border-left: 6px solid var(--red); }
  .banner.quiet { border: 2px dashed rgba(22,22,22,.35); background: transparent; font-size: 12px; font-weight: 600; padding: 6px 10px; }
  .b-title { font-size: 10.5px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }
  .b-main { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .b-note { font-size: 12.5px; margin-top: 3px; }
  .b-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .tip { margin-top: 6px; font-size: 11.5px; font-weight: 700; opacity: .7; }
  .linkbtn { border: 0; background: none; text-decoration: underline; text-underline-offset: 2px; font-weight: 800; padding: 0; }

  .sentbox { margin-top: 10px; }
  .sent-jp { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; font-weight: 700; line-height: 1.6; padding: 8px 10px;
    background: #fff; border: 2px solid var(--ink); border-left: 6px solid var(--red); border-radius: 6px; }
  .sent-jp .t { flex: 1 1 auto; min-width: 0; word-break: break-word; }
  mark { background: var(--yellow); color: inherit; padding: 0 2px; border-radius: 3px; box-shadow: 0 2px 0 var(--ink); }
  .sp { flex: 0 0 auto; width: 26px; height: 26px; border: 2px solid var(--ink); border-radius: 7px; background: var(--red); color: #fff;
    font-size: 10px; box-shadow: 2px 2px 0 var(--ink); display: grid; place-items: center; padding: 0; }
  .sp:active { transform: translate(1px,1px); box-shadow: 1px 1px 0 var(--ink); }
  .sent-en { margin-top: 6px; font-size: 13px; padding: 7px 10px; border: 2px dashed rgba(22,22,22,.45); border-radius: 6px; background: #fff; font-style: italic; }
  .src { font-style: normal; font-size: 10px; font-weight: 800; opacity: .55; margin-left: 6px; }
  .shim { display: inline-block; height: 10px; width: 60%; vertical-align: middle; border-radius: 5px;
    background: linear-gradient(90deg,#eee,#ddd,#eee); background-size: 200% 100%; animation: sh 1.2s infinite linear; }
  @keyframes sh { to { background-position: -200% 0; } }

  .tabs { display: flex; gap: 6px; margin-top: 10px; padding: 10px 0 8px; border-top: 2.5px solid var(--ink); position: sticky; top: 0; background: var(--paper); z-index: 2; }
  .tab { flex: 1; border: 2px solid var(--ink); background: #fff; border-radius: 8px; padding: 4px 6px; font-weight: 800; font-size: 12px; }
  .tab.on { background: var(--ink); color: var(--paper); }
  .tab .n { opacity: .7; font-weight: 700; margin-left: 4px; }
  .panel { padding-bottom: 8px; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { border: 2px solid var(--ink); background: #fff; border-radius: 8px; padding: 3px 8px; font-weight: 800; font-size: 12px; }
  .chip.on { background: var(--yellow); box-shadow: 2px 2px 0 var(--ink); }
  .chip small { font-weight: 700; opacity: .7; margin-left: 4px; }
  .infl { margin: 0 0 8px; font-size: 12px; font-weight: 700; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .pos { font-size: 12px; font-weight: 800; opacity: .7; margin: 10px 0 4px; }
  .pos:first-child { margin-top: 0; }
  .sense { display: flex; gap: 8px; padding: 6px 8px; border: 2px solid transparent; border-radius: 8px; }
  .sense:hover { border-color: rgba(22,22,22,.18); }
  .sense.pinned { background: #fff6d6; border-color: var(--ink); }
  .sense .num { flex: 0 0 18px; font-weight: 900; opacity: .55; }
  .sense .sb { flex: 1 1 auto; min-width: 0; }
  .defs { font-size: 14px; line-height: 1.4; }
  .meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
  .xref { font-size: 11.5px; margin-top: 4px; opacity: .85; }
  .xref a { font-weight: 700; text-underline-offset: 2px; }
  .pin { flex: 0 0 auto; align-self: flex-start; width: 26px; height: 26px; border: 2px solid transparent; border-radius: 7px; background: transparent; opacity: .35; font-size: 13px; padding: 0; }
  .sense:hover .pin, .sense.pinned .pin { opacity: 1; border-color: var(--ink); background: #fff; }

  .kcard { display: flex; gap: 10px; padding: 8px; border: 2px solid var(--ink); border-radius: 8px; background: #fff; margin-bottom: 8px; }
  .kglyph { font-size: 44px; font-weight: 900; line-height: 1.05; text-decoration: none; padding: 2px 8px 2px 4px; border-right: 2px dashed rgba(22,22,22,.4); }
  .kbody { min-width: 0; font-size: 12.5px; }
  .kmean { font-weight: 800; font-size: 13.5px; }
  .kread { margin-top: 2px; }
  .kread b { display: inline-block; min-width: 30px; opacity: .6; font-size: 11px; }

  .ex { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1.5px dashed rgba(22,22,22,.3); }
  .ex-jp { font-size: 15px; font-weight: 700; line-height: 1.9; }
  .ex-jp rt { font-size: 9px; font-weight: 600; }
  .ex-en { font-size: 12.5px; opacity: .85; }
  .credit { font-size: 10.5px; opacity: .6; margin-top: 8px; }

  .sec-title { font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; opacity: .65; margin: 14px 0 5px; }
  .sec-title:first-child { margin-top: 0; }
  .prow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 3px 0; }
  .pform { font-weight: 800; min-width: 64px; }
  .ptype { font-size: 11px; opacity: .65; font-weight: 700; }
  .links { display: flex; flex-wrap: wrap; gap: 6px; }
  .links a, .links button { border: 2px solid var(--ink); border-radius: 8px; padding: 3px 8px; font-weight: 800; font-size: 12px; background: #fff; text-decoration: none; }
  .links a:hover, .links button:hover { background: var(--yellow); }
  .togglerow { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 700; }
  .sw { border: 2px solid var(--ink); border-radius: 999px; padding: 2px 12px; font-weight: 900; background: #fff; }
  .sw.on { background: var(--green); color: #fff; }
  .empty { opacity: .7; padding: 6px 2px; }

  .foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px 12px; border-top: 2.5px solid var(--ink); }
  button.save { border: 3px solid var(--ink); background: #fff; font-weight: 900; border-radius: 8px; padding: 8px 12px; box-shadow: 3px 3px 0 var(--ink); transition: all .12s; }
  button.save:hover:not(:disabled) { background: var(--yellow); transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--ink); }
  button.save:active:not(:disabled) { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--ink); }
  button.save.saved { background: var(--green); color: #fff; }
  a.jisho-link { font-size: 12px; font-weight: 900; text-decoration: underline; text-underline-offset: 3px; }
  a.jisho-link:hover { color: var(--red); }
  .hint { font-size: 11px; opacity: .6; font-weight: 700; white-space: nowrap; }
  .toast { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%) translateY(6px); background: var(--ink); color: #fff;
    padding: 6px 12px; border-radius: 8px; font-weight: 700; font-size: 12px; opacity: 0; pointer-events: none; transition: all .18s; max-width: 90%; text-align: center; }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  button:focus-visible, a:focus-visible { outline: 3px solid var(--red); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .pop, .pop * { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
`;

const host = document.createElement("div");
host.id = "jp-popup";
host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; left: 0; top: 0; display: none;";
const root = host.attachShadow({ mode: "closed" });
root.innerHTML = `<style>${POPUP_CSS}</style>
  <div class="pop" id="pop" role="dialog" aria-label="Word lookup">
    <div class="scroll" id="scroll">
      <div class="head" id="head"></div>
      <div id="ctx"></div>
      <div class="tabs" id="tabs" role="tablist"></div>
      <div class="panel" id="panel"></div>
    </div>
    <div class="foot" id="foot"></div>
    <div class="toast" id="toast" role="status"></div>
  </div>`;
document.documentElement.appendChild(host);

const $pop = root.getElementById("pop");
const $head = root.getElementById("head");
const $scroll = root.getElementById("scroll");
const $ctx = root.getElementById("ctx");
const $tabs = root.getElementById("tabs");
const $panel = root.getElementById("panel");
const $foot = root.getElementById("foot");
const $toast = root.getElementById("toast");

let S = null;            // state of the current lookup
let popupOpen = false;
let lastTokEl = null;
let seqCounter = 0;
const transCache = new Map(); // sentence -> { text, source }

// ---------------------------------------------------------------- helpers
function sendMessageAsync(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        resolve(resp);
      });
    } catch (e) {
      reject(e);
    }
  });
}
async function send(msg) {
  try {
    return (await sendMessageAsync(msg)) || { ok: false, error: "No response from the extension" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function friendlyError(msg) {
  msg = String(msg || "");
  if (/context invalidated|Receiving end does not exist/i.test(msg)) return "The extension was just reloaded. Refresh this page and try again.";
  if (/timed out/i.test(msg)) return "The dictionary took too long to answer. Try again.";
  if (/HTTP 429|rate/i.test(msg)) return "The dictionary is rate-limiting requests. Wait a few seconds and try again.";
  return msg || "Could not fetch data.";
}
function aiErrorText(code, msg) {
  if (code === "rate-limit") return "Gemini limit reached for now (free-tier quota).";
  if (code === "bad-key") return "Gemini rejected the request. Check your API key.";
  return msg || "AI context failed.";
}

let toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

// ------------------------------------------------------------ sentence info
const SENT_END = /[。！？!?]/;

function extractSentenceInfo(original, absIndex) {
  if (!original) return { text: "", start: 0 };
  const s = original;
  const i = Math.max(0, Math.min(absIndex, s.length));
  let start = 0;
  for (let k = i; k >= 0; k--) {
    const ch = s[k];
    if (ch && SENT_END.test(ch)) { start = k + 1; break; }
  }
  let end = s.length;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (ch && SENT_END.test(ch)) { end = k + 1; break; }
  }
  const raw = s.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  return { text: raw.trim(), start: start + lead };
}

function getAbsoluteIndex(tokEl) {
  const runWrap = tokEl.closest("[data-jp-run-start]");
  const container = tokEl.closest("[data-jp-original]");
  if (!runWrap || !container) return { original: null, abs: 0 };
  const runStart = Number(runWrap.dataset.jpRunStart || "0");
  const rel = Number(tokEl.dataset.tokRelStart || "0");
  return { original: container.dataset.jpOriginal || "", abs: runStart + rel };
}

function gatherContext(tok) {
  const { original, abs } = getAbsoluteIndex(tok);
  const runWrap = tok.closest("[data-jp-run-start]");
  const siblings = runWrap
    ? Array.from(runWrap.children).filter((el) => el.classList && el.classList.contains("jp-token"))
    : [tok];
  const idx = Math.max(0, siblings.indexOf(tok));
  const tokens = siblings.slice(idx, idx + 8).map((t) => t.textContent);
  const prevToken = idx > 0 ? siblings[idx - 1].textContent : "";
  const info = original ? extractSentenceInfo(original, abs) : { text: "", start: 0 };
  const clicked = tokens[0] || "";
  const following = original ? original.slice(abs + clicked.length, abs + clicked.length + 24) : "";
  return { abs, tokens, prevToken, sentence: info.text, sentStart: info.start, following };
}

function clipSentence(sentence, spanStart) {
  if (sentence.length <= 360) return sentence;
  const c = spanStart >= 0 ? spanStart : 0;
  return sentence.slice(Math.max(0, c - 180), c + 180);
}

// ------------------------------------------------------------------- state
function newState(tok, clicked, ci) {
  return {
    seq: ++seqCounter, tok, clicked, surface: clicked, prefixLen: 0,
    phase: "loading", error: "",
    entries: [], entryIdx: 0, inflection: null, likelyName: false, nameReason: "", approx: false,
    sentence: ci.sentence, sentStart: ci.sentStart, abs: ci.abs, spanStart: -1, spanLen: 0,
    translation: "", transSource: "", transState: ci.sentence ? "loading" : "none", transError: "",
    ai: null, aiState: "idle", aiError: "", aiCode: "", aiHasKey: false, aiEnabled: false,
    pin: null, pinSource: "",
    pitchAll: null, pitchState: "loading",
    freqBy: {}, kanjiBy: {}, exBy: {}, exState: {}, exErr: {},
    tab: "meaning", saveState: "idle"
  };
}

const curEntry = () => (S && S.entries[S.entryIdx]) || null;

function trustedAiReading(e) {
  const a = S && S.aiState === "done" ? S.ai : null;
  if (!a || !a.reading || !e) return false;
  if (a.isName || a.entry < 0) return true;
  return (e.forms || []).some((f) => NC.sameKana(f.reading || "", a.reading));
}
function shownReading(e) {
  if (!e) return "";
  return trustedAiReading(e) ? S.ai.reading : e.reading || (NC.isKanaOnly(e.word) ? e.word : "");
}

function accentsFor(wordForm, reading) {
  const list = (S && S.pitchAll) || [];
  const hit =
    list.find((x) => (x.word || "") === (wordForm || "") && NC.sameKana(x.reading || "", reading || "")) ||
    list.find((x) => NC.sameKana(x.reading || "", reading || "") && (!x.word || x.word === wordForm));
  return hit ? hit.accents : [];
}

// ------------------------------------------------------------------ lookups
async function startLookup(tok) {
  const clicked = (tok.textContent || "").trim();
  if (!clicked) return;
  const ci = gatherContext(tok);
  NA.stop();
  const st = (S = newState(tok, clicked, ci));
  lastTokEl = tok;
  renderAll();
  openPopup();

  const statusP = send({ type: "AI_STATUS" });
  const lookupP = send({
    type: "SMART_LOOKUP", clicked, tokens: ci.tokens, prevToken: ci.prevToken, following: ci.following
  });

  const status = await statusP;
  if (S !== st) return;
  st.aiHasKey = !!(status.ok && status.hasKey);
  st.aiEnabled = !!(status.ok && status.hasKey && status.enabled);
  if (!st.aiEnabled) loadMT(st);

  const lk = await lookupP;
  if (S !== st) return;
  if (!lk.ok) {
    st.phase = "error";
    st.error = friendlyError(lk.error);
    renderAll();
    return;
  }
  st.surface = lk.surface;
  st.prefixLen = lk.prefixLen || 0;
  st.entries = lk.entries || [];
  st.entryIdx = 0;
  st.inflection = lk.inflection;
  st.likelyName = !!lk.likelyName;
  st.nameReason = lk.nameReason || "";
  st.approx = !!lk.approx;
  const rel = st.abs - st.prefixLen - st.sentStart;
  st.spanStart = st.sentence.substr(rel, st.surface.length) === st.surface ? rel : st.sentence.indexOf(st.surface);
  st.spanLen = st.spanStart >= 0 ? st.surface.length : 0;
  st.phase = "ready";
  autoPick(st);
  renderAll();

  loadPitch(st);
  loadFreq(st, st.entryIdx);
  loadKanji(st, st.entryIdx);
  if (st.aiEnabled) loadAI(st);
}

function autoPick(st) {
  if (st.pinSource === "user" || st.pinSource === "ai") return;
  const e = st.entries[st.entryIdx];
  if (!e) { st.pin = null; st.pinSource = ""; return; }
  const sc = NC.scoreSenses(e, { translation: st.translation, likelyName: st.likelyName });
  if (sc.confident) { st.pin = { entry: st.entryIdx, senses: [sc.best] }; st.pinSource = "context"; }
  else { st.pin = null; st.pinSource = ""; }
}

async function loadMT(st) {
  if (!st.sentence) return;
  const cached = transCache.get(st.sentence);
  if (cached) {
    st.translation = cached.text; st.transSource = cached.source; st.transState = "done";
    renderAll();
    return;
  }
  st.transState = "loading";
  const r = await send({ type: "TRANSLATE_JA_EN", text: st.sentence });
  if (S !== st) return;
  if (r.ok && r.translated) {
    st.translation = r.translated; st.transSource = "MT"; st.transState = "done";
    transCache.set(st.sentence, { text: r.translated, source: "MT" });
    if (st.phase === "ready") autoPick(st);
  } else {
    st.transState = "error"; st.transError = friendlyError(r.error);
  }
  renderAll();
}

async function loadAI(st) {
  st.aiState = "loading";
  renderAll();
  const r = await send({
    type: "AI_CONTEXT", sentence: clipSentence(st.sentence, st.spanStart), clicked: st.clicked, surface: st.surface,
    likelyName: st.likelyName, nameReason: st.nameReason, entries: st.entries.slice(0, 4)
  });
  if (S !== st) return;
  if (!r.ok) {
    st.aiState = r.code === "no-key" || r.code === "disabled" ? "off" : "error";
    st.aiCode = r.code || ""; st.aiError = aiErrorText(r.code, r.error);
    if (st.transState !== "done") loadMT(st);
    renderAll();
    return;
  }
  const a = r.ai;
  st.ai = a; st.aiState = "done";
  if (a.translation) {
    st.translation = a.translation; st.transSource = "AI"; st.transState = "done";
    transCache.set(st.sentence, { text: a.translation, source: "AI" });
  } else if (st.transState !== "done") loadMT(st);

  if (!st.entries.length && (a.meaning || a.isName)) {
    const w = a.lemma || st.surface;
    const label = a.isName ? "Name (AI guess)" : "AI guess";
    st.entries = [{
      slug: "ai:" + w, word: w, reading: a.reading || "", synthetic: true, isName: !!a.isName, isCommon: false,
      forms: [{ word: NC.hasKanji(w) ? w : null, reading: a.reading || null }], jlpt: [], wk: null, tags: [],
      pos: [label], attribution: {},
      senses: [{ pos: [label], posAll: [label], wiki: false, defs: [a.meaning || w], tags: ["not in the dictionary"],
        info: [], restrictions: [], seeAlso: [], antonyms: [], links: [], source: [] }]
    }];
    st.entryIdx = 0;
  }
  if (st.pinSource !== "user") {
    if (a.entry >= 0 && a.entry < st.entries.length) {
      if (a.entry !== st.entryIdx) { st.entryIdx = a.entry; loadFreq(st, a.entry); loadKanji(st, a.entry); }
      st.pin = a.senses.length ? { entry: a.entry, senses: a.senses } : null;
    } else { st.pin = null; }
    st.pinSource = "ai";
  }
  renderAll();
}

async function loadPitch(st) {
  const forms = [];
  const seen = new Set();
  st.entries.forEach((e) => (e.forms || []).slice(0, 4).forEach((f) => {
    const k = (f.word || "") + "|" + (f.reading || "");
    if (!seen.has(k) && forms.length < 14) { seen.add(k); forms.push({ word: f.word, reading: f.reading }); }
  }));
  if (!forms.length) { st.pitchState = "none"; renderAll(); return; }
  const r = await send({ type: "PITCH_LOOKUP", forms });
  if (S !== st) return;
  if (!r.ok || r.status === "unavailable") st.pitchState = "unavailable";
  else { st.pitchAll = r.results; st.pitchState = r.results.length ? "ready" : "none"; }
  renderAll();
}

async function loadFreq(st, idx) {
  const e = st.entries[idx];
  if (!e || st.freqBy[idx] !== undefined) return;
  st.freqBy[idx] = null;
  const r = await send({ type: "FREQ_LOOKUP", forms: (e.forms || []).slice(0, 4).map((f) => ({ word: f.word, reading: f.reading })) });
  if (S !== st) return;
  st.freqBy[idx] = r.ok && r.freq && Object.keys(r.freq).length ? r.freq : null;
  renderAll();
}

async function loadKanji(st, idx) {
  const e = st.entries[idx];
  if (!e || st.kanjiBy[idx] !== undefined) return;
  const chars = NC.kanjiOf(e.word).slice(0, 8);
  if (!chars.length) { st.kanjiBy[idx] = []; return; }
  st.kanjiBy[idx] = undefined;
  const r = await send({ type: "KANJI_LOOKUP", chars });
  if (S !== st) return;
  st.kanjiBy[idx] = r.ok ? r.kanji : [];
  renderAll();
}

async function ensureExamples() {
  const st = S, idx = st.entryIdx, e = curEntry();
  if (!e || e.synthetic || st.exBy[idx] !== undefined || st.exState[idx] === "loading") return;
  st.exState[idx] = "loading";
  renderAll();
  const word = NC.hasKanji(e.word) || !e.reading ? e.word : e.reading;
  const r = await send({ type: "EXAMPLES_LOOKUP", word, alt: [e.reading, st.surface].filter(Boolean), limit: 5 });
  if (S !== st) return;
  if (r.ok) { st.exBy[idx] = r.examples; st.exState[idx] = "done"; }
  else { st.exState[idx] = "error"; st.exErr[idx] = friendlyError(r.error); }
  renderAll();
}

// ---------------------------------------------------------------- rendering
function pitchHTML(reading, accents) {
  if (!reading || !accents || !accents.length) return "";
  return accents.map((a) => {
    const p = NC.pitchPattern(reading, a.n);
    const m = p.morae.map((x, i) =>
      `<span class="m${p.heights[i] ? " h" : ""}${p.dropAfter === i ? " d" : ""}">${esc(x)}</span>`).join("");
    const label = `[${a.n}] ${p.type}` + (a.note ? ` (${a.note})` : "");
    return `<span class="pitch" title="${esc(label)}">${m}<span class="pn">[${a.n}]</span></span>`;
  }).join("");
}

function badgesHTML(e) {
  if (!e) return "";
  const out = [];
  if (e.synthetic) out.push('<span class="pill ai">AI guess</span>');
  if (e.isCommon) out.push('<span class="pill common">★ common</span>');
  (e.jlpt || []).forEach((l) => out.push(`<span class="pill lvl">JLPT ${esc(l)}</span>`));
  if (e.wk) out.push(`<span class="pill lvl">WaniKani ${e.wk}</span>`);
  const fr = S.freqBy[S.entryIdx];
  if (fr) Object.keys(fr).forEach((k) => out.push(`<span class="pill freq">${esc(fr[k].label)} #${fr[k].rank.toLocaleString()}</span>`));
  if (e.isName && !e.synthetic) out.push('<span class="pill name">name</span>');
  (e.tags || []).slice(0, 4).forEach((t) => out.push(`<span class="pill soft">${esc(t)}</span>`));
  return out.join("");
}

function headHTML() {
  const st = S, e = curEntry();
  if (st.phase === "loading") {
    return `<div class="hrow"><div class="word" lang="ja">${esc(st.clicked)}</div></div>
      <div class="readline"><span class="reading"><span class="shim"></span></span></div>`;
  }
  if (st.phase === "error" || !e) {
    return `<div class="hrow"><div class="word" lang="ja">${esc(st.surface)}</div></div>`;
  }
  const word = e.word;
  const rd = shownReading(e);
  const dict = e.reading || "";
  const segs = NC.alignFurigana(word, rd);
  const accents = accentsFor(e.word, rd);
  const differs = rd && dict && !NC.sameKana(rd, dict);
  return `
    <div class="hrow">
      <div class="word" lang="ja">${NC.rubyHTML(segs)}</div>
      <div class="hbtns">
        <button class="play slow" data-act="speak-slow" title="Play slowly (text-to-speech)" aria-label="Play slowly">🐢</button>
        <button class="play" data-act="speak" title="Play pronunciation" aria-label="Play pronunciation">▶</button>
      </div>
    </div>
    <div class="readline">
      ${rd && NC.hasKanji(word) && !accents.length ? `<span class="reading" lang="ja">${esc(rd)}</span>` : ""}
      ${pitchHTML(rd, accents)}
      ${differs ? `<span class="dictread">dictionary: ${esc(dict)}</span>` : ""}
    </div>
    <div class="badges">${badgesHTML(e)}</div>`;
}

function defsOf(sense, n) {
  return sense ? sense.defs.slice(0, n || 4).join("; ") : "";
}

function bannerHTML() {
  const st = S, e = curEntry();
  if (st.phase !== "ready") return "";
  const pinSense = st.pin && e && st.pin.entry === st.entryIdx ? e.senses[st.pin.senses[0]] : null;

  if (st.pinSource === "user" && pinSense) {
    return `<div class="banner user"><div class="b-title">📌 Your pick (goes on the card)</div>
      <div class="b-main">${esc(defsOf(pinSense))}</div></div>`;
  }
  if (st.aiState === "loading") {
    return `<div class="banner ai"><div class="b-title">✨ AI · reading the sentence…</div><div class="b-main"><span class="shim"></span></div></div>`;
  }
  if (st.aiState === "done" && st.ai) {
    const a = st.ai;
    const chips = [];
    if (a.isName) chips.push('<span class="pill name">name / proper noun</span>');
    if (a.inflection) chips.push(`<span class="pill soft">${esc(a.inflection)}</span>`);
    if (a.reading && e && !NC.sameKana(a.reading, e.reading || "") && trustedAiReading(e)) chips.push(`<span class="pill soft">read: ${esc(a.reading)}</span>`);
    if (a.confidence === "low") chips.push('<span class="pill soft">low confidence</span>');
    const main = a.meaning || defsOf(pinSense) || st.surface;
    return `<div class="banner ai"><div class="b-title">✨ In this sentence</div>
      <div class="b-main">${esc(main)}</div>
      ${a.note ? `<div class="b-note">${esc(a.note)}</div>` : ""}
      ${chips.length ? `<div class="b-chips">${chips.join("")}</div>` : ""}</div>`;
  }
  if (st.likelyName) {
    return `<div class="banner name"><div class="b-title">👤 Probably a name here</div>
      <div class="b-main">${esc(st.surface)}</div>
      <div class="b-note">It's ${esc(st.nameReason)}, so the plain dictionary meaning may not apply.${st.aiHasKey ? "" : " Add a Gemini key in the AI chat for a full explanation."}</div></div>`;
  }
  if (pinSense) {
    return `<div class="banner ctx"><div class="b-title">🎯 Best match for this sentence</div>
      <div class="b-main">${esc(defsOf(pinSense))}</div></div>`;
  }
  return "";
}

function transHTML() {
  const st = S;
  if (st.transState === "loading") return '<div class="sent-en"><span class="shim"></span></div>';
  if (st.transState === "done") {
    return `<div class="sent-en">${esc(st.translation)}<span class="src">${esc(st.transSource === "AI" ? "AI" : "machine translation")}</span></div>`;
  }
  if (st.transState === "error") return `<div class="sent-en">(Translation unavailable: ${esc(st.transError)})</div>`;
  return "";
}

function ctxHTML() {
  const st = S;
  let html = bannerHTML();
  if (st.sentence) {
    html += `<div class="sentbox">
      <div class="sent-jp"><button class="sp" data-act="speak-sent" title="Read the sentence aloud" aria-label="Read sentence aloud">▶</button>
      <div class="t" lang="ja">${NC.highlightText(st.sentence, st.spanStart, st.spanLen)}</div></div>${transHTML()}</div>`;
  } else {
    html += '<div class="sentbox"><div class="sent-en">(Could not extract a sentence.)</div></div>';
  }
  if (st.phase === "ready" && st.aiState === "error") {
    html += `<div class="banner quiet">✨ AI context unavailable: ${esc(st.aiError)} <button class="linkbtn" data-act="ai-retry">Retry</button></div>`;
  } else if (st.phase === "ready" && !st.aiHasKey) {
    html += '<div class="tip">✨ Add a Gemini key in the AI chat for meanings that fit each sentence.</div>';
  }
  return html;
}

function tabsHTML() {
  const e = curEntry();
  const nk = e ? NC.kanjiOf(e.word).length : 0;
  const ex = S.exBy[S.entryIdx];
  const tabs = [
    ["meaning", "Meaning", e ? e.senses.length : 0],
    ["kanji", "Kanji", nk],
    ["examples", "Examples", ex ? ex.length : 0],
    ["details", "Details", 0]
  ];
  return tabs.map(([id, label, n]) =>
    `<button class="tab${S.tab === id ? " on" : ""}" role="tab" aria-selected="${S.tab === id}" data-act="tab" data-tab="${id}">${label}${n ? `<span class="n">${n}</span>` : ""}</button>`
  ).join("");
}

function senseHTML(e, i) {
  const s = e.senses[i];
  const pinned = !!(S.pin && S.pin.entry === S.entryIdx && S.pin.senses.includes(i));
  const meta = [];
  if (s.wiki) meta.push('<span class="pill soft">Wikipedia</span>');
  (s.tags || []).forEach((t) => meta.push(`<span class="pill">${esc(t)}</span>`));
  (s.info || []).forEach((t) => meta.push(`<span class="pill soft">${esc(t)}</span>`));
  (s.restrictions || []).forEach((t) => meta.push(`<span class="pill soft">only: ${esc(t)}</span>`));
  const link = (t) => `<a href="https://jisho.org/search/${encodeURIComponent(String(t).split(" ")[0])}" target="_blank" rel="noreferrer noopener">${esc(t)}</a>`;
  const xrefs = [];
  if (s.seeAlso && s.seeAlso.length) xrefs.push("see also: " + s.seeAlso.map(link).join(", "));
  if (s.antonyms && s.antonyms.length) xrefs.push("antonym: " + s.antonyms.map(link).join(", "));
  (s.links || []).slice(0, 1).forEach((l) => {
    if (l && /^https?:/.test(l.url || "")) xrefs.push(`<a href="${esc(l.url)}" target="_blank" rel="noreferrer noopener">${esc(l.text || "link")}</a>`);
  });
  return `<div class="sense${pinned ? " pinned" : ""}">
    <div class="num">${i + 1}</div>
    <div class="sb"><div class="defs">${esc(s.defs.join("; ") || "(no definition)")}</div>
      ${meta.length ? `<div class="meta">${meta.join("")}</div>` : ""}
      ${xrefs.length ? `<div class="xref">${xrefs.join(" · ")}</div>` : ""}</div>
    <button class="pin" data-act="pin" data-i="${i}" title="${pinned ? "Unpin" : "Use this meaning on the card"}" aria-label="Use this meaning on the card" aria-pressed="${pinned}">📌</button>
  </div>`;
}

function meaningPanel() {
  const e = curEntry();
  if (!e) {
    const why = S.likelyName
      ? "It looks like a name here, so there is no plain dictionary entry."
      : "It may be a name or slang. Try “Open in Jisho”.";
    return `<div class="empty">No dictionary entry for <b lang="ja">${esc(S.surface)}</b>. ${S.aiState === "loading" ? "Asking the AI…" : why}</div>`;
  }
  let html = "";
  if (S.entries.length > 1) {
    html += '<div class="chips">' + S.entries.map((x, i) =>
      `<button class="chip${i === S.entryIdx ? " on" : ""}" data-act="entry" data-i="${i}" lang="ja">${esc(x.word)}<small>${esc(x.reading && x.reading !== x.word ? x.reading : (x.pos[0] || ""))}</small>${x.isName ? "<small>name</small>" : ""}</button>`
    ).join("") + "</div>";
  }
  const infl = S.inflection && S.entryIdx === 0 ? S.inflection : null;
  const m = infl ? infl : NC.matchInflection(S.surface, e);
  if (m && m.labels && m.labels.length && S.surface !== e.word) {
    html += `<div class="infl"><span lang="ja"><b>${esc(S.surface)}</b> ← ${esc(e.word)}</span>${m.labels.map((l) => `<span class="pill soft">${esc(l)}</span>`).join("")}</div>`;
  }
  let lastPos = null;
  e.senses.forEach((s, i) => {
    const key = (s.posAll || []).join(", ");
    if (key !== lastPos) { html += `<div class="pos">${esc(key || "—")}</div>`; lastPos = key; }
    html += senseHTML(e, i);
  });
  return html;
}

function gradeLabel(g) {
  if (g == null) return "";
  if (g >= 1 && g <= 6) return `Grade ${g}`;
  if (g === 8) return "Jōyō (secondary)";
  if (g === 9 || g === 10) return "Jinmeiyō (names)";
  return "";
}

function kanjiPanel() {
  const e = curEntry();
  if (!e) return '<div class="empty">No entry selected.</div>';
  if (!NC.hasKanji(e.word)) return '<div class="empty">This word is written in kana, so there are no kanji to break down.</div>';
  const list = S.kanjiBy[S.entryIdx];
  if (list === undefined) return '<div class="empty"><span class="shim"></span></div>';
  if (!list.length) return '<div class="empty">Kanji details are unavailable right now.</div>';
  return list.map((k) => {
    const pills = [];
    if (k.strokes) pills.push(`<span class="pill">${k.strokes} strokes</span>`);
    if (gradeLabel(k.grade)) pills.push(`<span class="pill lvl">${gradeLabel(k.grade)}</span>`);
    if (k.freq) pills.push(`<span class="pill freq">news #${k.freq}</span>`);
    if (k.heisig) pills.push(`<span class="pill soft">RTK: ${esc(k.heisig)}</span>`);
    return `<div class="kcard">
      <a class="kglyph" lang="ja" href="https://jisho.org/search/${encodeURIComponent(k.kanji)}%20%23kanji" target="_blank" rel="noreferrer noopener" title="Open on Jisho">${esc(k.kanji)}</a>
      <div class="kbody"><div class="kmean">${esc((k.meanings || []).slice(0, 5).join(", ") || "—")}</div>
        ${k.on && k.on.length ? `<div class="kread" lang="ja"><b>On</b> ${esc(k.on.join("、"))}</div>` : ""}
        ${k.kun && k.kun.length ? `<div class="kread" lang="ja"><b>Kun</b> ${esc(k.kun.join("、"))}</div>` : ""}
        <div class="meta">${pills.join("")}</div></div></div>`;
  }).join("") + '<div class="credit">Kanji data: kanjiapi.dev (KANJIDIC2)</div>';
}

function examplesPanel() {
  const e = curEntry();
  if (!e) return '<div class="empty">No entry selected.</div>';
  if (e.synthetic) return '<div class="empty">No example sentences for AI guesses.</div>';
  const idx = S.entryIdx, st = S.exState[idx];
  if (st === "loading" || (st === undefined && S.exBy[idx] === undefined)) return '<div class="empty"><span class="shim"></span></div>';
  if (st === "error") return `<div class="empty">Couldn't load examples: ${esc(S.exErr[idx])} <button class="linkbtn" data-act="ex-retry">Retry</button></div>`;
  const list = S.exBy[idx] || [];
  if (!list.length) return '<div class="empty">No example sentences found for this word.</div>';
  const needles = [e.word, e.reading, S.surface];
  return list.map((x, i) => `<div class="ex">
    <button class="sp" data-act="speak-ex" data-i="${i}" title="Read aloud" aria-label="Read example aloud">▶</button>
    <div><div class="ex-jp" lang="ja">${NC.rubyHTML(NC.markSegments(x.segs, needles))}</div><div class="ex-en">${esc(x.en)}</div></div>
  </div>`).join("") + '<div class="credit">Sentences: Tatoeba (CC BY 2.0 FR)</div>';
}

function detailsPanel() {
  const e = curEntry();
  if (!e) return '<div class="empty">No entry selected.</div>';
  let html = '<div class="sec-title">Pitch accent</div>';
  const rows = [];
  for (const f of (e.forms || []).slice(0, 6)) {
    const rd = f.reading || e.reading;
    const acc = accentsFor(f.word || e.word, rd);
    if (!acc.length) continue;
    const types = acc.map((a) => NC.pitchPattern(rd, a.n).type).filter((t, i, arr) => arr.indexOf(t) === i).join(" / ");
    rows.push(`<div class="prow"><span class="pform" lang="ja">${esc(f.word || f.reading)}</span>${pitchHTML(rd, acc)}<span class="ptype">${esc(types)}</span></div>`);
  }
  if (rows.length) html += rows.join("") + '<div class="credit">Pitch data: Kanjium (NHK / Wadoku / Daijirin).</div>';
  else if (S.pitchState === "loading") html += '<div class="empty"><span class="shim"></span></div>';
  else if (S.pitchState === "unavailable") html += '<div class="empty">Pitch data hasn\'t finished its one-time download yet. Try again in a minute.</div>';
  else html += '<div class="empty">No pitch accent data for this word.</div>';

  if ((e.forms || []).length > 1 || (e.forms[0] && e.forms[0].word)) {
    html += '<div class="sec-title">Written forms &amp; readings</div><div class="links">' +
      e.forms.slice(0, 10).map((f) => `<span class="pill" lang="ja">${esc(f.word || f.reading)}${f.word && f.reading ? ` 【${esc(f.reading)}】` : ""}</span>`).join("") + "</div>";
  }
  const facts = [];
  if (e.isCommon) facts.push('<span class="pill common">★ common word</span>');
  (e.jlpt || []).forEach((l) => facts.push(`<span class="pill lvl">JLPT ${esc(l)}</span>`));
  if (e.wk) facts.push(`<span class="pill lvl">WaniKani level ${e.wk}</span>`);
  const fr = S.freqBy[S.entryIdx];
  if (fr) Object.keys(fr).forEach((k) => facts.push(`<span class="pill freq">${esc(fr[k].label)} frequency #${fr[k].rank.toLocaleString()}</span>`));
  (e.pos || []).forEach((p) => facts.push(`<span class="pill soft">${esc(p)}</span>`));
  if (facts.length) html += '<div class="sec-title">Level, frequency &amp; type</div><div class="meta">' + facts.join("") + "</div>";

  const w = encodeURIComponent(e.word);
  const links = [
    ["Jisho", `https://jisho.org/search/${w}`], ["Weblio", `https://www.weblio.jp/content/${w}`],
    ["Kotobank", `https://kotobank.jp/word/${w}`], ["Wiktionary", `https://en.wiktionary.org/wiki/${w}#Japanese`],
    ["Forvo", `https://forvo.com/word/${w}/#ja`], ["Images", `https://www.google.com/search?tbm=isch&q=${w}`],
    ["Tatoeba", `https://tatoeba.org/en/sentences/search?query=${w}&from=jpn`]
  ];
  html += '<div class="sec-title">Look it up elsewhere</div><div class="links">' +
    links.map(([n, u]) => `<a href="${u}" target="_blank" rel="noreferrer noopener">${n}</a>`).join("") +
    '<button data-act="copy-word">Copy word</button><button data-act="copy-sent">Copy sentence</button></div>';

  html += '<div class="sec-title">AI context</div><div class="togglerow"><span>' +
    (S.aiHasKey ? "Pick meanings with your Gemini key" : "No Gemini key saved (add one in the AI chat)") +
    `</span><button class="sw${S.aiEnabled ? " on" : ""}" data-act="toggle-ai" ${S.aiHasKey ? "" : "disabled"}>${S.aiEnabled ? "ON" : "OFF"}</button></div>`;
  html += '<div class="credit">Dictionary: JMdict via Jisho.org (EDRDG licence).</div>';
  return html;
}

function panelHTML() {
  const st = S;
  if (st.phase === "loading") return '<div class="empty"><span class="shim"></span><br><br><span class="shim" style="width:40%"></span></div>';
  if (st.phase === "error") return `<div class="empty">${esc(st.error)} <button class="linkbtn" data-act="retry">Retry</button></div>`;
  if (st.tab === "kanji") return kanjiPanel();
  if (st.tab === "examples") return examplesPanel();
  if (st.tab === "details") return detailsPanel();
  return meaningPanel();
}

function footHTML() {
  const e = curEntry();
  const w = e ? e.word : S.surface;
  const label = { idle: "⭐ Save", saving: "⏳ Saving…", saved: "✅ Saved", dup: "♻️ Already saved", fail: "❌ Failed" }[S.saveState || "idle"];
  return `<button class="save${S.saveState === "saved" ? " saved" : ""}" data-act="save" ${S.phase !== "ready" || !e ? "disabled" : ""}>${label}</button>
    <a class="jisho-link" href="https://jisho.org/search/${encodeURIComponent(w)}" target="_blank" rel="noreferrer noopener">Open in Jisho</a>
    <span class="hint">esc to close</span>`;
}

function renderAll() {
  if (!S) return;
  const top = $scroll.scrollTop;
  $head.innerHTML = headHTML();
  $ctx.innerHTML = ctxHTML();
  $tabs.innerHTML = tabsHTML();
  $panel.innerHTML = panelHTML();
  $foot.innerHTML = footHTML();
  $scroll.scrollTop = top;
  if (popupOpen) positionPopup();
}

// ------------------------------------------------------------- popup window
function positionPopup() {
  if (!lastTokEl || !lastTokEl.isConnected) return;
  const pad = 12, gap = 10;
  const tokRect = lastTokEl.getBoundingClientRect();
  const vh = window.innerHeight;
  $pop.style.maxHeight = ""; // measure the natural height first
  const naturalH = $pop.offsetHeight;
  const w = $pop.offsetWidth;
  const spaceBelow = vh - tokRect.bottom - gap - pad;
  const spaceAbove = tokRect.top - gap - pad;
  const below = spaceBelow >= naturalH || spaceBelow >= spaceAbove;
  const avail = below ? spaceBelow : spaceAbove;
  if (naturalH > avail) $pop.style.maxHeight = Math.max(260, avail) + "px"; // scroll inside, don't cover the word
  const h = $pop.offsetHeight;
  let x = tokRect.left + tokRect.width / 2 - w / 2;
  let y = below ? tokRect.bottom + gap : tokRect.top - h - gap;
  x = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
  y = Math.max(pad, Math.min(y, vh - h - pad));
  const up = !below;
  host.style.left = `${x}px`;
  host.style.top = `${y}px`;
  const notchX = Math.max(24, Math.min(w - 24, tokRect.left + tokRect.width / 2 - x));
  $pop.classList.toggle("up", up);
  $pop.style.setProperty("--notch-x", `${notchX}px`);
  $pop.style.setProperty("--origin-x", `${notchX}px`);
}

function openPopup() {
  popupOpen = true;
  host.style.display = "block";
  $pop.classList.remove("show");
  positionPopup();
  requestAnimationFrame(() => $pop.classList.add("show"));
}

function closePopup() {
  if (!popupOpen) return;
  popupOpen = false;
  S = null;
  lastTokEl = null;
  $pop.classList.remove("show");
  NA.stop();
  setTimeout(() => { if (!popupOpen) host.style.display = "none"; }, 170);
}

window.addEventListener("scroll", () => { if (popupOpen) positionPopup(); }, true);
window.addEventListener("resize", () => { if (popupOpen) positionPopup(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopup(); });

document.addEventListener("click", (e) => {
  const path = e.composedPath ? e.composedPath() : [];
  if (path.includes(host)) return;
  if (e.target && e.target.closest && e.target.closest(".jp-token")) return;
  if (popupOpen) closePopup();
});

// ---------------------------------------------------------------- actions
async function speakWord(slow) {
  const e = curEntry();
  if (!S || !e) return;
  const reading = shownReading(e);
  try {
    await NA.playWord({ word: NC.hasKanji(e.word) ? e.word : "", reading: reading || e.word, native: !slow, rate: slow ? 0.65 : 1 });
  } catch (err) {
    toast(NA.hasVoice() ? "Couldn't play audio." : "No Japanese voice installed. Add one in your system's speech settings.");
  }
}

async function speakSentence() {
  if (!S || !S.sentence) return;
  const e = curEntry();
  const a = S.aiState === "done" ? S.ai : null;
  const surfaceReading = (a && a.spanReading) || (e && S.surface === e.word ? shownReading(e) : "");
  try {
    await NA.playSentence({ sentence: S.sentence, surface: S.surface, reading: surfaceReading });
  } catch (err) {
    toast(NA.hasVoice() ? "Couldn't play audio." : "No Japanese voice installed. Add one in your system's speech settings.");
  }
}

function compactSenses(e) {
  const list = [], map = new Map();
  e.senses.forEach((s, i) => {
    if (s.wiki || list.length >= 10) return;
    map.set(i, list.length);
    list.push({
      pos: (s.posAll || []).slice(0, 3), defs: s.defs.slice(0, 8), tags: (s.tags || []).slice(0, 5), info: (s.info || []).slice(0, 3),
      restrictions: (s.restrictions || []).slice(0, 3), seeAlso: (s.seeAlso || []).slice(0, 3), antonyms: (s.antonyms || []).slice(0, 3)
    });
  });
  return { list, map };
}

function buildCard() {
  const st = S, e = curEntry();
  const ai = st.aiState === "done" ? st.ai : null;
  const aiHere = !!ai && (ai.entry === st.entryIdx || ai.entry < 0);
  const pinSenses = st.pin && st.pin.entry === st.entryIdx ? st.pin.senses : [];
  const { list, map } = compactSenses(e);
  const reading = shownReading(e);
  let contextMeaning = "", contextBy = "";
  if (st.pinSource === "user" && pinSenses.length) { contextMeaning = defsOf(e.senses[pinSenses[0]]); contextBy = "you"; }
  else if (aiHere && ai.meaning) { contextMeaning = ai.meaning; contextBy = "ai"; }
  else if (pinSenses.length) { contextMeaning = defsOf(e.senses[pinSenses[0]]); contextBy = "sentence"; }
  const contextNote = aiHere && ai.note ? ai.note : st.likelyName ? `Probably a name here (${st.nameReason}).` : "";
  const m = NC.matchInflection(st.surface, e);
  return {
    word: e.word, reading,
    surface: st.surface, surfaceReading: (ai && ai.spanReading) || (st.surface === e.word ? reading : ""),
    sentenceJP: st.sentence, sentenceEN: st.translation, spanStart: st.spanStart, spanLen: st.spanLen,
    sourceURL: location.href, sourceTitle: (document.title || "").slice(0, 160),
    meaningHTML: NC.meaningHTML(e, pinSenses[0]),
    contextMeaning, contextBy, contextNote,
    isName: !!(aiHere && ai.isName) || !!e.isName,
    inflection: m && m.labels && st.surface !== e.word ? m.labels : [],
    pos: (e.pos || []).slice(0, 4), senses: list,
    pinSense: pinSenses.length && map.has(pinSenses[0]) ? map.get(pinSenses[0]) : null,
    forms: (e.forms || []).slice(0, 6), jlpt: e.jlpt || [], wk: e.wk || null, common: !!e.isCommon,
    // left undefined when not loaded yet, so the flashcard page can fetch them later
    pitch: st.pitchState === "ready" || st.pitchState === "none" ? accentsFor(e.word, reading) : undefined,
    freq: st.freqBy[st.entryIdx] || undefined,
    kanji: st.kanjiBy[st.entryIdx] && st.kanjiBy[st.entryIdx].length ? st.kanjiBy[st.entryIdx] : undefined,
    examples: st.exBy[st.entryIdx] || undefined,
    tags: [...(e.isCommon ? ["common"] : []), ...(e.jlpt || [])]
  };
}

// ========== LOCAL SRS INTEGRATION ==========
async function saveToLocalSRS(cardData) {
  const key = "srsCards";
  const data = await chrome.storage.local.get(key);
  const cards = Array.isArray(data[key]) ? data[key] : [];

  // Check for duplicates
  const exists = cards.find((c) => c.word === cardData.word && c.reading === cardData.reading);
  if (exists) return { success: false, duplicate: true, id: exists.id };

  // Create new card with FSRS initial state
  const fsrs = new FSRS();
  const emptyCard = fsrs.createEmptyCard();
  const newCard = { ...emptyCard, id: crypto.randomUUID(), ...cardData, createdAt: new Date().toISOString() };
  cards.push(newCard);
  await chrome.storage.local.set({ [key]: cards });
  return { success: true, card: newCard };
}

async function doSave() {
  const st = S, e = curEntry();
  if (!st || st.phase !== "ready" || !e) return;
  st.saveState = "saving";
  $foot.innerHTML = footHTML();
  try {
    const result = await saveToLocalSRS(buildCard());
    st.saveState = result.duplicate ? "dup" : "saved";
  } catch (err) {
    console.error("Save failed:", err);
    st.saveState = "fail";
  }
  if (S === st) $foot.innerHTML = footHTML();
  setTimeout(() => { if (S === st) { st.saveState = "idle"; $foot.innerHTML = footHTML(); } }, 1500);
}

root.addEventListener("click", async (ev) => {
  ev.stopPropagation(); // clicks inside the popup never reach the page
  const el = ev.target.closest && ev.target.closest("[data-act]");
  if (!el || !S) return;
  const act = el.dataset.act;
  const idx = Number(el.dataset.i);
  if (act === "tab") {
    S.tab = el.dataset.tab;
    renderAll();
    if (S.tab === "examples") ensureExamples();
  } else if (act === "entry") {
    S.entryIdx = idx;
    if (S.pinSource !== "user") { S.pinSource = ""; S.pin = null; autoPick(S); }
    renderAll();
    loadFreq(S, idx); loadKanji(S, idx);
    if (S.tab === "examples") ensureExamples();
  } else if (act === "pin") {
    const same = S.pin && S.pin.entry === S.entryIdx && S.pin.senses.length === 1 && S.pin.senses[0] === idx && S.pinSource === "user";
    if (same) { S.pin = null; S.pinSource = ""; autoPick(S); }
    else { S.pin = { entry: S.entryIdx, senses: [idx] }; S.pinSource = "user"; }
    renderAll();
  } else if (act === "speak") speakWord(false);
  else if (act === "speak-slow") speakWord(true);
  else if (act === "speak-sent") speakSentence();
  else if (act === "speak-ex") {
    const ex = (S.exBy[S.entryIdx] || [])[idx];
    if (ex) NA.playSentence({ sentence: ex.jp }).catch(() => toast("Couldn't play audio."));
  } else if (act === "save") doSave();
  else if (act === "retry") startLookup(S.tok);
  else if (act === "ai-retry") loadAI(S);
  else if (act === "ex-retry") { S.exBy[S.entryIdx] = undefined; S.exState[S.entryIdx] = undefined; ensureExamples(); }
  else if (act === "copy-word") { const e = curEntry(); toast((await copyText(e ? e.word : S.surface)) ? "Word copied" : "Copy failed"); }
  else if (act === "copy-sent") toast((await copyText(S.sentence)) ? "Sentence copied" : "Copy failed");
  else if (act === "toggle-ai") {
    const next = !S.aiEnabled;
    await chrome.storage.local.set({ aiContextEnabled: next });
    S.aiEnabled = next;
    if (next && S.aiState !== "done") loadAI(S); else renderAll();
    toast(next ? "AI context on" : "AI context off");
  }
});

document.addEventListener("click", (e) => {
  const tok = e.target && e.target.closest && e.target.closest(".jp-token");
  if (!tok) return;
  e.preventDefault();
  e.stopPropagation();
  startLookup(tok);
});
