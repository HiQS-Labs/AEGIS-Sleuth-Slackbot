// FILE: tests/context-file-classifier.test.js
'use strict';

const {
  GetFileExtension,
  IsTextLikeContextFile,
  IsBinaryMediaFile,
  SelectContextMemoryFile,
  LooksLikeHtmlErrorPage,
} = require('../src/context-file-classifier');

describe('context-file-classifier', () => {
  describe('GetFileExtension', () => {
    test('returns the lowercased extension', () => {
      expect(GetFileExtension('MSA-DRAFT.MD')).toBe('md');
      expect(GetFileExtension('report.final.csv')).toBe('csv');
      expect(GetFileExtension('/path/to/query.sql')).toBe('sql');
    });

    test('returns empty string for extensionless or dotfile names', () => {
      expect(GetFileExtension('shop2client-a-slowqueries')).toBe('');
      expect(GetFileExtension('Makefile')).toBe('');
      expect(GetFileExtension('.gitignore')).toBe('');
      expect(GetFileExtension('')).toBe('');
      expect(GetFileExtension(undefined)).toBe('');
    });
  });

  describe('IsTextLikeContextFile', () => {
    test('accepts a Markdown file by extension (legacy behavior preserved)', () => {
      expect(IsTextLikeContextFile({ name: 'MSA-DRAFT.md' })).toBe(true);
    });

    test('accepts a wide range of text/code/data extensions', () => {
      for(const Name of ['notes.txt', 'mysql-slow.log', 'data.csv', 'config.json', 'deploy.yaml', 'query.sql', 'script.sh', 'app.js', 'main.py']) {
        expect(IsTextLikeContextFile({ name: Name })).toBe(true);
      }
    });

    test('accepts a Slack code snippet that has no extension but a text mimetype', () => {
      // this is the exact shape from the bug report: a slow-query snippet with no ".md".
      expect(IsTextLikeContextFile({ name: 'shop2client-a-slowqueries', mimetype: 'text/plain' })).toBe(true);
    });

    test('accepts a Slack snippet by its language filetype when name/mimetype are unhelpful', () => {
      expect(IsTextLikeContextFile({ name: 'shop2client-a-slowqueries', filetype: 'shell' })).toBe(true);
      expect(IsTextLikeContextFile({ name: 'untitled', filetype: 'sql' })).toBe(true);
    });

    test('accepts non-text/ textual application mimetypes', () => {
      expect(IsTextLikeContextFile({ name: 'x', mimetype: 'application/json' })).toBe(true);
      expect(IsTextLikeContextFile({ name: 'x', mimetype: 'application/x-sh' })).toBe(true);
    });

    test('accepts conventional extensionless text filenames', () => {
      expect(IsTextLikeContextFile({ name: 'Dockerfile' })).toBe(true);
      expect(IsTextLikeContextFile({ name: 'Makefile' })).toBe(true);
    });

    test('rejects binary media and unknown binary attachments', () => {
      expect(IsTextLikeContextFile({ name: 'diagram.png', mimetype: 'image/png' })).toBe(false);
      expect(IsTextLikeContextFile({ name: 'contract.pdf', mimetype: 'application/pdf' })).toBe(false);
      expect(IsTextLikeContextFile({ name: 'archive.zip', mimetype: 'application/zip' })).toBe(false);
      expect(IsTextLikeContextFile({ name: 'mystery', mimetype: 'application/octet-stream' })).toBe(false);
      expect(IsTextLikeContextFile(null)).toBe(false);
    });
  });

  describe('IsBinaryMediaFile', () => {
    test('flags image/video/audio/font mimetypes', () => {
      expect(IsBinaryMediaFile({ mimetype: 'image/png' })).toBe(true);
      expect(IsBinaryMediaFile({ mimetype: 'video/mp4' })).toBe(true);
      expect(IsBinaryMediaFile({ mimetype: 'audio/mpeg' })).toBe(true);
    });

    test('does not flag a PDF or unknown type as media (still unsupported, just not "binary media")', () => {
      expect(IsBinaryMediaFile({ mimetype: 'application/pdf' })).toBe(false);
      expect(IsBinaryMediaFile({ mimetype: 'application/octet-stream' })).toBe(false);
    });
  });

  describe('SelectContextMemoryFile', () => {
    test('returns no-files for empty/undefined input', () => {
      expect(SelectContextMemoryFile(undefined).Kind).toBe('no-files');
      expect(SelectContextMemoryFile([]).Kind).toBe('no-files');
    });

    test('returns the first text-readable file when one is present', () => {
      const Files = [
        { name: 'logo.png', mimetype: 'image/png' },
        { name: 'notes.md', mimetype: 'text/markdown' },
      ];
      const Result = SelectContextMemoryFile(Files);
      expect(Result.Kind).toBe('text');
      expect(Result.File.name).toBe('notes.md');
    });

    test('returns unsupported with the first attachment when none are text-readable', () => {
      const Files = [{ name: 'logo.png', mimetype: 'image/png' }];
      const Result = SelectContextMemoryFile(Files);
      expect(Result.Kind).toBe('unsupported');
      expect(Result.File.name).toBe('logo.png');
    });
  });

  describe('LooksLikeHtmlErrorPage', () => {
    test('flags a Slack HTML wrapper/login page', () => {
      expect(LooksLikeHtmlErrorPage('<!DOCTYPE html>\n<html><head>...')).toBe(true);
      expect(LooksLikeHtmlErrorPage('  <html lang="en">')).toBe(true);
    });

    test('does NOT flag genuine text that merely starts with "<" (XML/SVG/HTML fragment/JSX)', () => {
      expect(LooksLikeHtmlErrorPage('<?xml version="1.0"?><root/>')).toBe(false);
      expect(LooksLikeHtmlErrorPage('<svg viewBox="0 0 10 10"></svg>')).toBe(false);
      expect(LooksLikeHtmlErrorPage('<Component prop={x} />')).toBe(false);
      expect(LooksLikeHtmlErrorPage('# Heading\nplain markdown')).toBe(false);
    });
  });
});
