'use strict';

const fs = require('fs');
const path = require('path');
const {
  CommandCatalogPath,
  LoadCommandCatalogSync,
  BuildHelpMarkdownFromCatalog,
} = require('../src/command-catalog');

const HelpFilePath = path.join(__dirname, '..', 'data', 'static', 'HELP.md');

function main() {
  const Catalog = LoadCommandCatalogSync();
  const HelpText = BuildHelpMarkdownFromCatalog(Catalog);
  fs.writeFileSync(HelpFilePath, HelpText, 'utf8');
  process.stdout.write(
    `generated ${path.relative(process.cwd(), HelpFilePath)} from ${path.relative(process.cwd(), CommandCatalogPath)}\n`
  );
}

main();
