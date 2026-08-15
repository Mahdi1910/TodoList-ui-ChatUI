/**
 * attachment-types.js — Gemini-supported attachment MIME normalization and presentation.
 *
 * Direct chat attachments use this registry for product-level acceptance and MIME
 * normalization. The transport layer may use Gemini Files API or controlled
 * inlineData fallback at request time. Textual source files that have no dedicated
 * Gemini MIME type are sent as text/plain.
 */

const EXTENSION_MIME_TYPES = new Map([
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.xhtml', 'text/html'],
  ['.css', 'text/css'],
  ['.txt', 'text/plain'],
  ['.md', 'text/plain'],
  ['.markdown', 'text/plain'],
  ['.xml', 'text/xml'],
  ['.svg', 'text/xml'],
  ['.csv', 'text/csv'],
  ['.rtf', 'text/rtf'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.cjs', 'text/javascript'],
  ['.json', 'application/json'],
  ['.geojson', 'application/json'],
  ['.ipynb', 'application/json'],
  ['.pdf', 'application/pdf'],

  ['.bmp', 'image/bmp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],

  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
  ['.aif', 'audio/aiff'],
  ['.aiff', 'audio/aiff'],
  ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.flac', 'audio/flac'],

  ['.mp4', 'video/mp4'],
  ['.mpeg', 'video/mpeg'],
  ['.mpe', 'video/mpeg'],
  ['.mov', 'video/quicktime'],
  ['.avi', 'video/avi'],
  ['.flv', 'video/x-flv'],
  ['.mpg', 'video/mpg'],
  ['.webm', 'video/webm'],
  ['.wmv', 'video/wmv'],
  ['.3gp', 'video/3gpp']
]);

// Source/config files are plain text even when the browser reports an empty or
// vendor-specific MIME type. Gemini accepts text/plain directly, so preserving
// their readable source is preferable to rejecting them by extension.
const TEXT_SOURCE_EXTENSIONS = new Set([
  '.py', '.pyw', '.ts', '.tsx', '.jsx', '.java', '.c', '.cc', '.cpp', '.cxx',
  '.h', '.hh', '.hpp', '.hxx', '.cs', '.go', '.rs', '.php', '.rb', '.swift',
  '.kt', '.kts', '.dart', '.lua', '.r', '.pl', '.pm', '.scala', '.groovy',
  '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.yaml',
  '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.gradle',
  '.vue', '.svelte', '.tex', '.log', '.scss', '.sass', '.less', '.proto',
  '.graphql', '.gql', '.sol', '.asm', '.s', '.clj', '.cljs', '.ex', '.exs',
  '.erl', '.hrl', '.fs', '.fsx', '.vb', '.vbs', '.jsonl', '.ndjson', '.tsv',
  '.srt', '.vtt', '.ics', '.gitignore', '.dockerfile', '.makefile'
]);

const TEXT_SOURCE_BASENAMES = new Set([
  'dockerfile', 'makefile', 'procfile', 'gemfile', 'rakefile', 'license',
  'readme', 'changelog', '.gitignore', '.gitattributes', '.editorconfig'
]);

const SUPPORTED_MIME_TYPES = new Set([
  'text/html',
  'text/css',
  'text/plain',
  'text/markdown',
  'text/xml',
  'text/csv',
  'text/rtf',
  'text/javascript',
  'application/json',
  'application/pdf',
  'image/bmp',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/avi',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/3gpp'
]);

const MIME_ALIASES = new Map([
  ['application/javascript', 'text/javascript'],
  ['application/x-javascript', 'text/javascript'],
  ['application/xml', 'text/xml'],
  ['application/rtf', 'text/rtf'],
  ['text/x-markdown', 'text/plain'],
  ['text/json', 'application/json'],
  ['image/jpg', 'image/jpeg'],
  ['image/x-ms-bmp', 'image/bmp'],
  ['audio/x-wav', 'audio/wav'],
  ['audio/wave', 'audio/wav'],
  ['audio/x-aiff', 'audio/aiff'],
  ['video/x-msvideo', 'video/avi'],
  ['video/x-ms-wmv', 'video/wmv'],
  ['video/mov', 'video/quicktime'],
  ['video/x-quicktime', 'video/quicktime']
]);

const EXTENSION_LABELS = new Map([
  ['.html', 'HTML File'], ['.htm', 'HTML File'], ['.xhtml', 'HTML File'], ['.css', 'CSS File'],
  ['.js', 'JavaScript File'], ['.mjs', 'JavaScript File'], ['.cjs', 'JavaScript File'],
  ['.json', 'JSON File'], ['.geojson', 'JSON File'], ['.ipynb', 'Jupyter Notebook'],
  ['.xml', 'XML File'], ['.svg', 'SVG Source'], ['.csv', 'CSV File'], ['.rtf', 'RTF Document'],
  ['.md', 'Markdown File'], ['.markdown', 'Markdown File'], ['.txt', 'Text File'],
  ['.py', 'Python Source'], ['.ts', 'TypeScript Source'], ['.tsx', 'TypeScript JSX'],
  ['.jsx', 'JavaScript JSX'], ['.java', 'Java Source'], ['.cpp', 'C++ Source'],
  ['.c', 'C Source'], ['.cs', 'C# Source'], ['.go', 'Go Source'], ['.rs', 'Rust Source'],
  ['.php', 'PHP Source'], ['.rb', 'Ruby Source'], ['.swift', 'Swift Source'],
  ['.kt', 'Kotlin Source'], ['.sql', 'SQL File'], ['.yaml', 'YAML File'], ['.yml', 'YAML File']
]);

function getNormalizedBaseName(name = '') {
  const normalized = String(name || '').trim().toLowerCase().replaceAll('\\', '/');
  return normalized.split('/').pop() || '';
}

export function getFileExtension(name = '') {
  const baseName = getNormalizedBaseName(name);
  if (!baseName) return '';
  if (baseName === 'dockerfile') return '.dockerfile';
  if (baseName === 'makefile') return '.makefile';
  if (baseName === '.gitignore') return '.gitignore';
  const dotIndex = baseName.lastIndexOf('.');
  return dotIndex >= 0 ? baseName.slice(dotIndex) : '';
}

function normalizeReportedMimeType(type = '') {
  const normalized = String(type || '').trim().toLowerCase().split(';', 1)[0];
  return MIME_ALIASES.get(normalized) || normalized;
}

function isKnownTextSource(file) {
  const extension = getFileExtension(file?.name);
  const baseName = getNormalizedBaseName(file?.name);
  return TEXT_SOURCE_EXTENSIONS.has(extension) || TEXT_SOURCE_BASENAMES.has(baseName);
}

export function getGeminiAttachmentMimeType(file) {
  const extension = getFileExtension(file?.name);
  const extensionType = EXTENSION_MIME_TYPES.get(extension);
  if (extensionType) return extensionType;
  if (isKnownTextSource(file)) return 'text/plain';

  const reportedType = normalizeReportedMimeType(file?.type);
  if (SUPPORTED_MIME_TYPES.has(reportedType)) return reportedType;
  if (reportedType.startsWith('text/')) return 'text/plain';
  return reportedType;
}

export function isGeminiSupportedAttachment(file) {
  const extension = getFileExtension(file?.name);
  if (EXTENSION_MIME_TYPES.has(extension) || isKnownTextSource(file)) return true;

  const reportedType = normalizeReportedMimeType(file?.type);
  return SUPPORTED_MIME_TYPES.has(reportedType) || reportedType.startsWith('text/');
}

export function getAttachmentPresentation(file) {
  const mimeType = getGeminiAttachmentMimeType(file).toLowerCase();
  const extension = getFileExtension(file?.name);

  if (mimeType.startsWith('image/')) return { kind: 'image', icon: 'image', label: 'Image' };
  if (mimeType.startsWith('audio/')) return { kind: 'audio', icon: 'mic', label: 'Audio' };
  if (mimeType.startsWith('video/')) return { kind: 'video', icon: 'video', label: 'Video' };
  if (mimeType === 'application/pdf') return { kind: 'pdf', icon: 'file-text', label: 'PDF Document' };

  const explicitLabel = EXTENSION_LABELS.get(extension);
  if (explicitLabel) return { kind: 'text', icon: 'file-code-2', label: explicitLabel };
  if (mimeType === 'text/html') return { kind: 'text', icon: 'file-code-2', label: 'HTML File' };
  if (mimeType === 'text/css') return { kind: 'text', icon: 'file-code-2', label: 'CSS File' };
  if (mimeType === 'text/javascript') return { kind: 'text', icon: 'file-code-2', label: 'JavaScript File' };
  if (mimeType === 'application/json') return { kind: 'text', icon: 'braces', label: 'JSON File' };
  if (mimeType === 'text/xml') return { kind: 'text', icon: 'file-code-2', label: 'XML File' };
  if (mimeType === 'text/csv') return { kind: 'text', icon: 'table-2', label: 'CSV File' };
  if (mimeType === 'text/rtf') return { kind: 'text', icon: 'file-text', label: 'RTF Document' };
  if (mimeType.startsWith('text/')) return { kind: 'text', icon: 'file-text', label: 'Text / Source File' };

  return { kind: 'file', icon: 'paperclip', label: 'Attachment' };
}

export const GEMINI_ATTACHMENT_SUPPORT_SUMMARY = 'Gemini-supported images, audio, video, PDFs, text, web, data, and source-code files';
