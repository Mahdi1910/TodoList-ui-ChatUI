/**
 * TEMPORARY PERFORMANCE DIAGNOSTICS — remove after profiling is complete.
 */

import { loadSavedPerformanceRuns } from './performance-diagnostics.js';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventMs(run, name) {
  const value = run?.events?.[name]?.atMs;
  return value == null ? null : num(value);
}

function phaseMs(run, name) {
  const phase = run?.phases?.[name];
  return phase ? num(phase.totalMs) : null;
}

function ms(value) {
  if (value == null) return 'n/a';
  return value < 1000 ? `${value.toFixed(1)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function bytes(value) {
  const size = num(value);
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1048576).toFixed(2)} MB`;
}

function median(values) {
  const safe = values.filter(value => value != null).sort((a, b) => a - b);
  if (!safe.length) return null;
  const mid = Math.floor(safe.length / 2);
  return safe.length % 2 ? safe[mid] : (safe[mid - 1] + safe[mid]) / 2;
}

function rangeLine(label, values) {
  const safe = values.filter(value => value != null);
  if (!safe.length) return null;
  return `- ${label}: min ${ms(Math.min(...safe))} · median ${ms(median(safe))} · max ${ms(Math.max(...safe))}`;
}

function metrics(run) {
  const streamStart = eventMs(run, 'stream_call_started');
  const firstActivity = eventMs(run, 'first_activity_event');
  const firstVisible = eventMs(run, 'first_visible_activity');
  const streamComplete = eventMs(run, 'stream_complete');
  return {
    preStream: streamStart,
    generationWait: streamStart == null || firstActivity == null ? null : Math.max(0, firstActivity - streamStart),
    renderToVisible: firstActivity == null || firstVisible == null ? null : Math.max(0, firstVisible - firstActivity),
    streamAfterFirst: firstActivity == null || streamComplete == null ? null : Math.max(0, streamComplete - firstActivity),
    finalization: streamComplete == null ? null : Math.max(0, num(run.endToEndMs) - streamComplete),
    total: num(run.endToEndMs)
  };
}

function biggest(metricsForRun) {
  const items = [
    ['Frontend before generation', metricsForRun.preStream],
    ['Generation path before first activity', metricsForRun.generationWait],
    ['Browser render to first visible activity', metricsForRun.renderToVisible]
  ].filter(([, value]) => value != null);
  return items.length ? items.reduce((best, current) => current[1] > best[1] ? current : best) : null;
}

export function buildTemporaryPerformanceReport() {
  const runs = loadSavedPerformanceRuns();
  const lines = [
    '# ChatUI Temporary Performance Report',
    '',
    `Runs: ${runs.length}`,
    '',
    'Timing boundary: “Generation path before first activity” starts when ChatUI calls its Gemini streaming layer and ends when the first usable thinking/text/tool activity reaches ChatUI. It intentionally includes history preparation, request serialization, CORS/network/proxy/backend/model wait because the Gemini API module itself is not modified by this temporary profiler.',
    ''
  ];

  if (!runs.length) return `${lines.join('\n')}No runs captured yet.`;

  const allMetrics = runs.map(metrics);
  lines.push('## Summary', '');
  [
    rangeLine('Send → generation layer', allMetrics.map(item => item.preStream)),
    rangeLine('Generation layer → first usable activity', allMetrics.map(item => item.generationWait)),
    rangeLine('First activity → first visible UI', allMetrics.map(item => item.renderToVisible)),
    rangeLine('First activity → stream complete', allMetrics.map(item => item.streamAfterFirst)),
    rangeLine('End-to-end', allMetrics.map(item => item.total))
  ].filter(Boolean).forEach(line => lines.push(line));

  runs.forEach((run, index) => {
    const m = metrics(run);
    const largest = biggest(m);
    const meta = run.metadata || {};
    const history = run.history || {};
    const rendering = run.rendering || {};
    const conversions = run.attachmentConversions || {};
    lines.push('', `## Run ${index + 1}: ${run.requestKind || 'unknown'}`, '');
    lines.push(`- Status: ${run.status || 'unknown'}`);
    lines.push(`- Model / thinking: ${meta.model || 'unknown'} / ${meta.thinkingLevel || 'unknown'}`);
    lines.push(`- Text characters: ${Math.round(num(meta.textChars))}`);
    lines.push(`- Current attachments: ${Math.round(num(meta.currentAttachmentCount))} (${bytes(meta.currentAttachmentBytes)})`);
    lines.push(`- Chat messages before send: ${Math.round(num(meta.chatMessageCountBeforeSend))}`);
    lines.push(`- History messages included: ${Math.round(num(history.includedConversationMessageCount))}`);
    lines.push(`- Historical attachments: ${Math.round(num(history.historicalAttachmentCount))} (${bytes(history.historicalAttachmentBytes)})`);
    lines.push(`- Preserved model parts: ${Math.round(num(history.preservedModelPartCount))}`);
    lines.push(`- Send → generation layer: ${ms(m.preStream)}`);
    lines.push(`- Generation layer → first usable activity: ${ms(m.generationWait)}`);
    lines.push(`- First activity → first visible UI: ${ms(m.renderToVisible)}`);
    lines.push(`- First activity → stream complete: ${ms(m.streamAfterFirst)}`);
    lines.push(`- Stream complete → run complete: ${ms(m.finalization)}`);
    lines.push(`- End-to-end: ${ms(m.total)}`);
    if (largest) lines.push(`- Largest first-response area: ${largest[0]} — ${ms(largest[1])}`);

    lines.push('', '### Frontend phase detail');
    [
      ['audio_stop_and_blob_finalize', 'Audio finalization'],
      ['ensure_chat_loaded', 'Lazy chat load'],
      ['new_attachment_prepare_total', 'Attachment preparation'],
      ['persist_user_turn', 'Pre-generation local save'],
      ['render_user_message', 'User-message rendering'],
      ['sidebar_update_before_generation', 'Sidebar update'],
      ['persist_final_assistant', 'Final assistant save'],
      ['finish_generation_cleanup', 'Generation cleanup']
    ].forEach(([key, label]) => lines.push(`- ${label}: ${ms(phaseMs(run, key))}`));
    lines.push(`- Attachment conversion total / max: ${ms(num(conversions.totalMs))} / ${ms(num(conversions.maxMs))}`);

    const frames = Math.round(num(rendering.renderFrameCount));
    lines.push('', '### Streaming UI work');
    lines.push(`- Render frames: ${frames}`);
    lines.push(`- Render CPU total / max: ${ms(num(rendering.renderTotalMs))} / ${ms(num(rendering.renderMaxMs))}`);
    lines.push(`- Scroll work total / max: ${ms(num(rendering.scrollTotalMs))} / ${ms(num(rendering.scrollMaxMs))}`);

    if ((run.toolExecutions || []).length) {
      lines.push('', '### Client tool timings');
      run.toolExecutions.forEach((tool, toolIndex) => {
        lines.push(`- ${toolIndex + 1}. ${tool.name}: ${ms(num(tool.durationMs))} · ${tool.success ? 'success' : 'failed'}`);
      });
    }
  });

  return lines.join('\n');
}
