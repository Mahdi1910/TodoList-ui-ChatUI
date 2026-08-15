/**
 * message-tools.js - Render grounding, URL Context, code execution, and generated files.
 */

import { escapeHtml } from '../utils/dom.js';

export function appendToolMetadata(bubble, toolMeta, msgObj) {
  if (!bubble || !toolMeta) return;
  const hasActivityTimeline = Array.isArray(msgObj?.activityTimeline);
  const hasGoogleSearchActivity = hasActivityTimeline && msgObj.activityTimeline.some(activity =>
    activity?.type === 'tool' && activity?.provider === 'google-search'
  );

  const fetchedUrlsSet = new Set();
  if (toolMeta.urlContextMetadata?.urlMetadata?.length || toolMeta.urlContextMetadata?.retrievedUrls?.length) {
    const urlMetaList = toolMeta.urlContextMetadata.urlMetadata || toolMeta.urlContextMetadata.retrievedUrls || [];
    urlMetaList.forEach(item => {
      const url = item.retrievedUrl || item.url;
      if (url) fetchedUrlsSet.add(url.toLowerCase().trim());
    });
  }

  if (toolMeta.groundingMetadata?.webSearchQueries?.length || toolMeta.groundingMetadata?.groundingChunks?.length) {
    const groundingBox = document.createElement('div');
    groundingBox.className = 'grounding-section';
    const queries = toolMeta.groundingMetadata.webSearchQueries || [];
    let hasGroundingContent = false;
    if (queries.length > 0 && !hasGoogleSearchActivity) {
      const qDiv = document.createElement('div');
      qDiv.className = 'grounding-queries';
      qDiv.innerHTML = `<i data-lucide="search"></i> Searched: ${escapeHtml(queries.join(', '))}`;
      groundingBox.appendChild(qDiv);
      hasGroundingContent = true;
    }

    const rawChunks = toolMeta.groundingMetadata.groundingChunks || [];
    const chunks = rawChunks.filter(chunk => {
      const uri = (chunk.web?.uri || chunk.uri || '').toLowerCase().trim();
      return uri && !fetchedUrlsSet.has(uri);
    });

    if (chunks.length > 0) {
      const sourcesDiv = document.createElement('div');
      sourcesDiv.className = 'grounding-sources';
      chunks.forEach((chunk, idx) => {
        const uri = chunk.web?.uri || chunk.uri || '#';
        const title = chunk.web?.title || chunk.title || uri;
        const a = document.createElement('a');
        a.className = 'source-badge';
        a.href = uri;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = title;
        a.innerHTML = `[${idx + 1}] ${escapeHtml(title.length > 30 ? title.slice(0, 30) + '...' : title)}`;
        sourcesDiv.appendChild(a);
      });
      groundingBox.appendChild(sourcesDiv);
      hasGroundingContent = true;
    }
    if (hasGroundingContent) bubble.appendChild(groundingBox);
  }

  if (toolMeta.urlContextMetadata?.urlMetadata?.length || toolMeta.urlContextMetadata?.retrievedUrls?.length) {
    const urlMetaList = toolMeta.urlContextMetadata.urlMetadata || toolMeta.urlContextMetadata.retrievedUrls || [];
    if (urlMetaList.length > 0) {
      const urlBox = document.createElement('div');
      urlBox.className = 'url-context-section';
      urlMetaList.forEach(item => {
        const url = item.retrievedUrl || item.url || 'URL';
        const status = item.urlRetrievalStatus || item.status || 'SUCCESS';
        const isOk = status.includes('SUCCESS');
        const itemAnchor = document.createElement('a');
        itemAnchor.className = `url-status-item ${isOk ? 'success' : 'warning'}`;
        if (url && url !== 'URL') {
          itemAnchor.href = url;
          itemAnchor.target = '_blank';
          itemAnchor.rel = 'noopener noreferrer';
          itemAnchor.title = url;
        }
        itemAnchor.textContent = `${isOk ? 'Fetched' : 'Unsafe/Failed'}: ${url.length > 40 ? url.slice(0, 40) + '...' : url}`;
        urlBox.appendChild(itemAnchor);
      });
      bubble.appendChild(urlBox);
    }
  }

  if (Array.isArray(toolMeta.codeExecutions) && toolMeta.codeExecutions.length > 0) {
    const codeBox = document.createElement('div');
    codeBox.className = 'code-execution-wrapper';
    let appended = 0;

    toolMeta.codeExecutions.forEach(exec => {
      // Activity-enabled messages already show code/run/result chronology in
      // the agent timeline. Keep final downloadable artifacts here, but do not
      // duplicate the execution transcript beneath the answer.
      if (!hasActivityTimeline && exec.type === 'code' && exec.code) {
        const header = document.createElement('div');
        header.className = 'code-execution-header';
        header.innerHTML = '<span>Python Code Executed</span>';
        const pre = document.createElement('pre');
        pre.className = 'code-execution-output';
        pre.textContent = exec.code;
        codeBox.append(header, pre);
        appended += 1;
      } else if (!hasActivityTimeline && exec.type === 'result' && (exec.output || typeof exec.output === 'string')) {
        const header = document.createElement('div');
        header.className = 'code-execution-header';
        header.innerHTML = `<span>Execution Output (${escapeHtml(exec.outcome || 'OK')})</span>`;
        const pre = document.createElement('pre');
        pre.className = 'code-execution-output';
        pre.textContent = typeof exec.output === 'string' ? exec.output : JSON.stringify(exec.output, null, 2);
        codeBox.append(header, pre);
        appended += 1;
      } else if (exec.type === 'file' && (exec.data || exec.blob)) {
        const fileCard = renderSandboxFileCard(exec, msgObj);
        if (fileCard) {
          codeBox.appendChild(fileCard);
          appended += 1;
        }
      }
    });
    if (appended > 0) bubble.appendChild(codeBox);
  }
}

function getMimeMeta(mimeType = '') {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/png')) return { ext: 'png', icon: 'image', label: 'PNG Image' };
  if (mime.startsWith('image/jpeg') || mime.startsWith('image/jpg')) return { ext: 'jpg', icon: 'image', label: 'JPEG Image' };
  if (mime.startsWith('image/webp')) return { ext: 'webp', icon: 'image', label: 'WebP Image' };
  if (mime.includes('python') || mime.includes('x-python')) return { ext: 'py', icon: 'file-code', label: 'Python Script' };
  if (mime.includes('zip')) return { ext: 'zip', icon: 'archive', label: 'ZIP Archive' };
  if (mime.includes('csv')) return { ext: 'csv', icon: 'table', label: 'CSV Spreadsheet' };
  if (mime.includes('pdf')) return { ext: 'pdf', icon: 'file-text', label: 'PDF Document' };
  if (mime.includes('json')) return { ext: 'json', icon: 'file-json', label: 'JSON Data' };
  if (mime.startsWith('text/')) return { ext: 'txt', icon: 'file-text', label: 'Text File' };
  return { ext: 'bin', icon: 'file', label: 'File Artifact' };
}

function renderSandboxFileCard(fileExec, msgObj) {
  if (!fileExec || (!fileExec.data && !fileExec.blob)) return null;
  const mimeType = fileExec.mimeType || 'application/octet-stream';
  const meta = getMimeMeta(mimeType);
  const fileName = fileExec.fileName || `sandbox_output_${Date.now().toString(36)}.${meta.ext}`;

  let blob = fileExec.blob instanceof Blob ? fileExec.blob : null;
  if (!blob && typeof fileExec.data === 'string') {
    try {
      const byteCharacters = atob(fileExec.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
    } catch (e) {
      console.warn('Failed to convert Base64 file data to Blob:', e);
    }
  }

  const sizeInBytes = blob ? blob.size : Math.round(((fileExec.data || '').length * 3) / 4);
  const formattedSize = sizeInBytes > 1024 * 1024
    ? `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(sizeInBytes / 1024))} KB`;

  let blobUrl = '';
  if (blob) {
    blobUrl = URL.createObjectURL(blob);
    if (msgObj) {
      if (!Array.isArray(msgObj._blobUrls)) msgObj._blobUrls = [];
      msgObj._blobUrls.push(blobUrl);
    }
  } else if (fileExec.data) {
    blobUrl = `data:${mimeType};base64,${fileExec.data}`;
  }

  const card = document.createElement('div');
  card.className = 'sandbox-file-card';
  if (mimeType.startsWith('image/')) {
    card.innerHTML = `
      <div class="sandbox-image-preview"><img src="${blobUrl}" alt="${escapeHtml(fileName)}" class="sandbox-plot-img" /></div>
      <div class="sandbox-file-footer">
        <span class="sandbox-file-meta">${escapeHtml(fileName)} (${formattedSize})</span>
        <a href="${blobUrl}" download="${escapeHtml(fileName)}" class="download-file-btn"><i data-lucide="download"></i> Download Image</a>
      </div>`;
  } else {
    card.innerHTML = `
      <div class="sandbox-file-info">
        <div class="sandbox-file-icon"><i data-lucide="${meta.icon}"></i></div>
        <div class="sandbox-file-text"><span class="sandbox-file-title">${escapeHtml(fileName)}</span><span class="sandbox-file-meta">${formattedSize} - ${meta.label}</span></div>
      </div>
      <a href="${blobUrl}" download="${escapeHtml(fileName)}" class="download-file-btn"><i data-lucide="download"></i> Download File</a>`;
  }
  return card;
}
