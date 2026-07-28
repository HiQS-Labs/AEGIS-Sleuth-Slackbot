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

module.exports = {
  TEXT_FILE_EXTENSIONS,
  TEXT_FILETYPES,
  GetFileExtension,
  IsTextLikeContextFile,
  IsBinaryMediaFile,
  SelectContextMemoryFile,
  LooksLikeHtmlErrorPage,
};
