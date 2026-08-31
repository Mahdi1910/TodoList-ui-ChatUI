import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DIARY_STORAGE_PREFIX,
  installDiaryStorageNamespace
} from '../diary/src/platform/storage-namespace.mjs';
import {
  escapeHtml,
  renderBasicBoldHtml,
  safeFontAwesomeClass
} from '../diary/src/platform/html-safety.mjs';
import {
  DIARY_GEMINI_TASK_MODEL,
  DIARY_GEMINI_SUMMARY_MODEL
} from '../diary/src/features/gemini-rest.js';

const root = process.cwd();
const read = relative => readFile(path.join(root, relative), 'utf8');

function makeStorageClass() {
  return class MemoryStorage {
    constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
    get length() { return this.map.size; }
    key(index) { return [...this.map.keys()][index] ?? null; }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    removeItem(key) { this.map.delete(String(key)); }
    clear() { this.map.clear(); }
    raw(key) { return this.map.get(key); }
  };
}

{
  const Storage = makeStorageClass();
  const diary = new Storage({ theme: 'light', gemini_api_key: 'legacy-key', unrelated: 'keep-me' });
  const sessionLike = new Storage({ theme: 'session-theme' });
  assert.equal(installDiaryStorageNamespace(diary), true);
  assert.equal(diary.getItem('theme'), 'light', 'legacy Diary theme should migrate when Diary-specific evidence exists');
  assert.equal(diary.getItem('gemini_api_key'), 'legacy-key');
  assert.equal(diary.raw(`${DIARY_STORAGE_PREFIX}gemini_api_key`), 'legacy-key');
  diary.setItem('theme', 'dark');
  assert.equal(diary.raw(`${DIARY_STORAGE_PREFIX}theme`), 'dark');
  assert.equal(diary.raw('theme'), 'light', 'legacy values must remain untouched during compatibility migration');
  assert.equal(diary.raw('unrelated'), 'keep-me');
  assert.equal(sessionLike.getItem('theme'), 'session-theme', 'other Storage instances in the same realm must not be namespaced');
  diary.clear();
  assert.equal(diary.raw('unrelated'), 'keep-me', 'Diary clear must not clear unrelated same-origin storage');
  assert.equal(diary.raw('theme'), 'light', 'Diary clear must not delete legacy/shared keys');
}

{
  const Storage = makeStorageClass();
  const diary = new Storage({ theme: 'light' });
  installDiaryStorageNamespace(diary);
  assert.equal(diary.getItem('theme'), null, 'a generic pre-existing theme must not be adopted without Diary-specific evidence');
  assert.equal(diary.raw('theme'), 'light');
}

assert.equal(escapeHtml('<img src=x onerror="AndroidBridge.test()">'), '&lt;img src=x onerror=&quot;AndroidBridge.test()&quot;&gt;');
assert.equal(renderBasicBoldHtml('Hello **world** <script>x</script>'), 'Hello <strong>world</strong> &lt;script&gt;x&lt;/script&gt;');
assert.equal(safeFontAwesomeClass('fa-cloud-sun'), 'fa-cloud-sun');
assert.equal(safeFontAwesomeClass('fa-cloud" onload="x'), 'fa-cloud');

const [main, bridge, background, renderer, cardActions, aiNotes, summaries, embeddedCss, rootHtml, appShell, router, worker, server, buildStatic, geminiRest, microphone] = await Promise.all([
  read('diary/src/main.js'),
  read('diary/src/embedded/shell-bridge.js'),
  read('diary/src/features/background-recordings.js'),
  read('diary/src/features/ui-renderer.js'),
  read('diary/src/features/card-actions.js'),
  read('diary/src/features/ai-notes.js'),
  read('diary/src/features/summaries-ui.js'),
  read('diary/css/embedded.css'),
  read('index.html'),
  read('shell/js/app-shell.js'),
  read('shell/js/router.js'),
  read('worker.js'),
  read('server.py'),
  read('scripts/build-static.mjs'),
  read('diary/src/features/gemini-rest.js'),
  read('diary/src/features/microphone.js')
]);

assert(main.trimStart().startsWith("import './platform/storage-namespace.mjs';"));
assert(main.includes('embeddedBridge?.reportReady()'));
assert(main.indexOf('embeddedBridge?.reportReady()') < main.indexOf('cleanupOldAudioFiles()'), 'Diary must report ready before non-essential maintenance');
assert(bridge.includes("window.parent.postMessage") && bridge.includes("event.source !== window.parent"));
assert(bridge.includes("shell:active") && bridge.includes("shell:viewport-insets"));
assert(background.includes('pendingProcessingPromise'), 'background recording import needs a re-entry guard');
assert(background.includes('background_source'), 'background recording import needs crash/reload idempotence');
assert(background.includes('encodeURIComponent(filename)'), 'native filenames must not be interpolated raw into an appassets path');
assert(renderer.includes('escapeHtml(entry.title)') && renderer.includes('escapeHtml(entry.content'), 'entry rendering must escape stored diary text');
assert(cardActions.includes('replaceChildren(titleInput)') && !cardActions.includes('value="${originalTitle}"'), 'text editor must not interpolate diary text into HTML attributes');
assert(aiNotes.includes('escapeHtml(title)') && aiNotes.includes('escapeHtml(description)'), 'AI Note cards must escape stored text');
assert(summaries.includes('renderBasicBoldHtml'), 'summaries must allow only the intentionally supported safe formatting');
assert(embeddedCss.includes('data-shell-keyboard-open') && embeddedCss.includes('#nav-settings'), 'embedded mobile Diary layout must account for keyboard and Shell settings navigation');
assert(rootHtml.includes('id="diary-frame"') && rootHtml.includes('allow="microphone; geolocation; autoplay"'));
assert(appShell.includes('window.handleAndroidBack') && appShell.includes("getFrame('diary')"), 'Shell must preserve the Android hardware-back contract');
assert(router.includes("const DIARY_PATH = '/diary'"));
assert(worker.includes('diary\\/?$') || worker.includes('diary\\/?'));
assert(server.includes('diary/?$'));
assert(buildStatic.includes("'diary/src'"));

assert.equal(DIARY_GEMINI_TASK_MODEL, 'gemini-3.5-flash-lite', 'former Gemma Diary tasks must use Gemini 3.5 Flash-Lite');
assert.equal(DIARY_GEMINI_SUMMARY_MODEL, 'gemini-3.7-flash', 'Diary summaries must use Gemini 3.7 Flash');
assert(!geminiRest.includes('gemma-4-31b-it'), 'Diary runtime must not call Gemma 4 31B after the migration');
assert(!geminiRest.includes('gemini-3-flash-preview'), 'Diary summaries must not retain the old Gemini 3 Flash Preview model');
assert(!/DIARY_GEMINI_TASK_MODEL\s*=\s*'gemini-3\.5-flash'/.test(geminiRest), 'Diary task model must not regress to Gemini 3.5 Flash');
assert(!/temperature\s*:/.test(geminiRest), 'Gemini 3.7 Flash migration must not retain the deprecated temperature override');
assert(geminiRest.includes('responseMimeType: "application/json"') && geminiRest.includes('responseSchema'), 'Gemini 3.5 Flash-Lite structured-output tasks must keep schema-constrained JSON');
assert(geminiRest.includes("part?.thought !== true"), 'Gemini 3.x response extraction must ignore thought-only parts');
assert(microphone.includes('models/gemini-3.1-flash-live-preview'), 'this migration must not change the separate Gemini Live transcription model');

console.log('Diary storage, rendering, Android lifecycle, iframe, routing, and Gemini model verification passed.');
