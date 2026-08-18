// FILE: src/context-file-classifier.js
'use strict';

/** @typedef {import('./slack-app').SlackFileInfo} SlackFileInfo */

/**
 * Classifies Slack file attachments to decide whether one can be ingested as
 * thread context memory. A "context file" is any text-readable document — not
 * just Markdown — so Slack code snippets, logs, CSV/JSON/YAML, SQL and source
 * files all qualify. Binary uploads (images, video, audio, fonts) are reported
 * as unsupported so the caller can tell the user instead of silently ignoring
 * the file and then answering "I don't see any files".
 *
 * Detection is intentionally signal-redundant: a file counts as text when ANY
 * of its MIME type, Slack `filetype`, or name extension indicates text. Slack
 * inline snippets routinely arrive with a name that has no extension (e.g.
 * "shop2client-a-slowqueries") but carry `mimetype: text/plain` and a language
 * `filetype` (text/shell/sql), so name-only matching — the historical behavior —
 * misses them entirely.
 */

// Text-readable file extensions (without the leading dot).
const TEXT_FILE_EXTENSIONS = new Set([
  'md', 'markdown', 'mdown', 'mkd', 'txt', 'text', 'log',
  'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'sql', 'graphql', 'gql',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'pl', 'go', 'rs', 'java', 'kt', 'kts',
  'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'swift', 'scala', 'r', 'lua', 'dart', 'm',
  'diff', 'patch', 'gradle', 'tf', 'tsv',
]);

// Extensionless filenames whose bare name denotes a text file.
const TEXT_BARE_NAMES = new Set(['makefile', 'dockerfile', 'readme', 'license', 'changelog', 'gitignore', 'gemfile', 'rakefile', 'procfile']);

// MIME prefixes that are always binary media — a fast reject path.
const BINARY_MIMETYPE_PREFIXES = ['image/', 'video/', 'audio/', 'font/'];

// Supported image MIME types for Vision OCR processing.
const IMAGE_MIMETYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
]);

// Textual MIME types that do not start with "text/".
const TEXT_APPLICATION_MIMETYPES = new Set([
  'application/json', 'application/ld+json', 'application/xml', 'application/sql',
  'application/javascript', 'application/x-javascript', 'application/typescript',
  'application/x-sh', 'application/x-shellscript', 'application/x-yaml', 'application/yaml',
  'application/toml', 'application/x-httpd-php', 'application/graphql',
  'application/x-ndjson', 'application/csv', 'application/x-python', 'application/x-ruby',
]);

// Slack `filetype` values that denote text content. Slack uses short language
// names (e.g. "shell", "sql", "python") rather than MIME types for snippets.
const TEXT_FILETYPES = new Set([
  'text', 'markdown', 'post', 'csv', 'tsv', 'json', 'yaml', 'xml', 'html', 'css', 'sql', 'graphql',
  'shell', 'bash', 'sh', 'javascript', 'typescript', 'python', 'ruby', 'php', 'perl',
  'go', 'rust', 'java', 'kotlin', 'c', 'cpp', 'csharp', 'objc', 'swift', 'scala', 'r', 'lua', 'dart',
  'dockerfile', 'makefile', 'diff', 'patch', 'plain', 'ini', 'toml',
]);

/**
 * Extract the lowercased extension (without the dot) from a file name.
 * Returns '' when there is no extension or the name begins with a dot.
 * @param {string} ArgName File name, possibly including a path.
 * @returns {string}
 */
function GetFileExtension(ArgName) {
  const Lower = String(ArgName || '').toLowerCase().trim();
  const Slash = Math.max(Lower.lastIndexOf('/'), Lower.lastIndexOf('\\'));
  const Base = Slash >= 0 ? Lower.slice(Slash + 1) : Lower;
  const Dot = Base.lastIndexOf('.');
  // a leading dot (".gitignore") means the whole base is the type, not an extension.
  if(Dot <= 0) return '';
  return Base.slice(Dot + 1);
}

/**
 * Decide whether a Slack file is a text-readable document usable as context.
 * @param {{ name?: string, mimetype?: string, filetype?: string }} ArgFile Slack file object.
 * @returns {boolean}
 */
function IsTextLikeContextFile(ArgFile) {
  if(!ArgFile) return false;

  // an explicit text MIME type always wins, even for an extensionless snippet name.
  const Mimetype = String(ArgFile.mimetype || '').toLowerCase().trim();
  if(Mimetype.startsWith('text/')) return true;
  if(TEXT_APPLICATION_MIMETYPES.has(Mimetype)) return true;

  // Slack's snippet language tag.
  const Filetype = String(ArgFile.filetype || '').toLowerCase().trim();
  if(Filetype && TEXT_FILETYPES.has(Filetype)) return true;

  // fall back to the name extension (covers mocks and uploads with no MIME/filetype).
  const Extension = GetFileExtension(ArgFile.name);
  if(Extension && TEXT_FILE_EXTENSIONS.has(Extension)) return true;

  // extensionless conventional text files ("Makefile", "Dockerfile", "LICENSE").
  const BareName = String(ArgFile.name || '').toLowerCase().trim();
  if(BareName && !BareName.includes('.') && TEXT_BARE_NAMES.has(BareName)) return true;

  return false;
}

/**
 * Decide whether a Slack file is unambiguously binary media (image/video/audio/font).
 * Used only to phrase a clearer rejection message; non-binary-but-also-non-text
 * files (e.g. an unknown extension) are still treated as unsupported context.
 * @param {{ mimetype?: string }} ArgFile Slack file object.
 * @returns {boolean}
 */
function IsBinaryMediaFile(ArgFile) {
  if(!ArgFile) return false;
  const Mimetype = String(ArgFile.mimetype || '').toLowerCase().trim();
  return BINARY_MIMETYPE_PREFIXES.some((ArgPrefix) => Mimetype.startsWith(ArgPrefix));
}

/**
 * Pick the first text-readable file from a Slack files array and classify the result.
 * - 'no-files': nothing attached (caller should fall through to normal handling).
 * - 'text': a usable text file was found (returned in `File`).
 * - 'unsupported': files are attached but none are text-readable (`File` is the first
 *    attachment, for use in a user-facing message).
 * @param {SlackFileInfo[]|undefined} ArgFiles
 * @returns {{ File: SlackFileInfo|null, Kind: 'no-files'|'text'|'unsupported' }}
 */
function SelectContextMemoryFile(ArgFiles) {
  if(!Array.isArray(ArgFiles) || ArgFiles.length === 0)
    return { File: null, Kind: 'no-files' };
  const TextFile = ArgFiles.find((ArgFile) => IsTextLikeContextFile(ArgFile));
  if(TextFile) return { File: TextFile, Kind: 'text' };
  return { File: ArgFiles[0], Kind: 'unsupported' };
}

/**
 * Normalize attachment-accompanying text for intent matching: smart quotes to ASCII, any
 * whitespace run to a single space, trimmed, lowercased.
 * @param {string} ArgText Raw message text.
 * @returns {string}
 */
function NormalizeAttachmentText(ArgText) {
  return String(ArgText)
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Detect a list-creation intent in the text accompanying an attachment (GH-58, GH-62).
 * Lives here rather than in ChatModule so that attachment classification and the intent that
 * selects a handler are decided in ONE place — the split between them is what made the OCR
 * feature unreachable (GH-62). GH-64 extends this with catalog-driven aliases; GH-73 widens the
 * grammar to survive modifier words ("make a TODO list", "build a checklist") that the original
 * verb+article+list sequence missed in production.
 * @param {string} ArgText Message text with the bot mention already stripped.
 * @returns {boolean}
 */
function HasListCreationIntent(ArgText) {
  if(typeof ArgText !== 'string') return false;
  const NormalizedText = NormalizeAttachmentText(ArgText);
  if(NormalizedText.length === 0) return false;

  // 0-2 modifier words ("a todo list", "a to-do list", "a task checklist") are allowed between the
  // article and the list noun — requiring "list" immediately after the article is the exact gap
  // that mis-routed "make a todo list for by OCRing the attached image" (GH-73).
  return /\b(create|extract|convert|make|build|generate)\s+(a\s+|an\s+)?([a-z-]+\s+){0,2}(list|checklist)\b/i.test(NormalizedText)
    || /ocr\s+(a\s+)?list/i.test(NormalizedText)
    || /extract.*items?\s*(from|of)/i.test(NormalizedText)
    || /list\s*(out|up|format)/i.test(NormalizedText);
}

/**
 * Detect a scan-only intent — the user wants the text OUT of an image, not a Slack List built
 * from it (GH-73). Distinguished from `HasListCreationIntent` because the two select different
 * actions downstream: a match here must stop after extraction and post the text, never
 * materialize a list.
 * @param {string} ArgText Message text with the bot mention already stripped.
 * @returns {boolean}
 */
function HasImageTextExtractionIntent(ArgText) {
  if(typeof ArgText !== 'string') return false;
  const NormalizedText = NormalizeAttachmentText(ArgText);
  if(NormalizedText.length === 0) return false;

  return /\b(ocr|scan|read)\b.*\b(image|picture|photo|screenshot)s?\b/i.test(NormalizedText);
}

/**
 * Single resolver for "what is this attachment, and who owns it?" (GH-62).
 *
 * Replaces the previous arrangement where `SelectContextMemoryFile` and `SelectImageAttachment`
 * were consulted independently by two different branches of ChatModule and disagreed: an image
 * was 'unsupported' to the first and a valid selection to the second, so whichever branch ran
 * first won. That is why GH-58's OCR feature never executed.
 *
 * Resolution order is deliberate:
 * - A text-readable attachment always wins. Text context memory is the older, broader capability,
 *   and a user attaching a document plus an image most likely wants the document read.
 * - An image only routes to an OCR action when the accompanying text carries a list or scan
 *   intent. An image with no such intent stays 'unsupported' so the existing "I can only read
 *   text files" guidance still fires — silently ignoring an attachment is the failure mode this
 *   whole module exists to prevent.
 * - Between the two image arms, the list intent wins: "make a todo list by OCRing the attached
 *   image" carries both signals and the user wants the list (GH-73).
 *
 * @param {SlackFileInfo[]|undefined} ArgFiles Attachments from the Slack event payload.
 * @param {string} [ArgText] Message text with the bot mention stripped.
 * @returns {{ Kind: 'none'|'text'|'image-list'|'image-text'|'unsupported', File: SlackFileInfo|null }}
 */
function ResolveAttachmentIntent(ArgFiles, ArgText) {
  if(!Array.isArray(ArgFiles) || ArgFiles.length === 0)
    return { Kind: 'none', File: null };

  const TextFile = ArgFiles.find((ArgFile) => IsTextLikeContextFile(ArgFile));
  if(TextFile) return { Kind: 'text', File: TextFile };

  const ImageFile = SelectImageAttachment(ArgFiles);
  if(ImageFile && HasListCreationIntent(ArgText))
    return { Kind: 'image-list', File: ImageFile };
  if(ImageFile && HasImageTextExtractionIntent(ArgText))
    return { Kind: 'image-text', File: ImageFile };

  return { Kind: 'unsupported', File: ArgFiles[0] };
}

/**
 * Heuristic guard for content that is actually a Slack HTML error/login page rather
 * than the requested file. Deliberately narrow (only a leading HTML document marker)
 * so genuine text uploads that legitimately start with '<' — XML, SVG, HTML fragments,
 * JSX, generics-heavy code — are NOT misclassified as a failed download.
 * @param {string} ArgContent Downloaded file content.
 * @returns {boolean}
 */
function LooksLikeHtmlErrorPage(ArgContent) {
  const Head = String(ArgContent || '').trimStart().slice(0, 200).toLowerCase();
  return Head.startsWith('<!doctype html') || Head.startsWith('<html');
}

/**
 * Decide whether a Slack file is an image supported by Gemini Vision OCR.
 * @param {{ mimetype?: string }} ArgFile Slack file object.
 * @returns {boolean}
 */
function IsImageMediaFile(ArgFile) {
  if(!ArgFile) return false;
  const Mimetype = String(ArgFile.mimetype || '').toLowerCase().trim();
  return IMAGE_MIMETYPES.has(Mimetype);
}

/**
 * Pick the first image attachment from a Slack files array (for Vision OCR),
 * or null when no image is attached.
 * @param {SlackFileInfo[]|undefined} ArgFiles
 * @returns {SlackFileInfo|null}
 */
function SelectImageAttachment(ArgFiles) {
  if(!Array.isArray(ArgFiles) || ArgFiles.length === 0) return null;
  return ArgFiles.find((ArgFile) => IsImageMediaFile(ArgFile)) || null;
}

module.exports = {
  TEXT_FILE_EXTENSIONS,
  TEXT_FILETYPES,
  IMAGE_MIMETYPES,
  GetFileExtension,
  IsTextLikeContextFile,
  IsBinaryMediaFile,
  IsImageMediaFile,
  SelectContextMemoryFile,
  SelectImageAttachment,
  HasListCreationIntent,
  HasImageTextExtractionIntent,
  ResolveAttachmentIntent,
  LooksLikeHtmlErrorPage,
};
