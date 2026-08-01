'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load KEY=value pairs from the repo-root `.env` into `process.env`.
 * Existing environment variables are never overwritten.
 * @param {string} [ArgEnvPath] Optional path to a .env file (defaults to repo root).
 * @returns {void}
 */
function LoadEnvFile(ArgEnvPath) {
  const EnvPath = ArgEnvPath || path.resolve(path.join(__dirname, '..', '.env'));
  if(!fs.existsSync(EnvPath))
    return;

  const Lines = fs.readFileSync(EnvPath, 'utf8').split(/\r?\n/);
  for(const Line of Lines) {
    const Trimmed = Line.trim();
    if(!Trimmed || Trimmed.startsWith('#'))
      continue;

    const EqIndex = Trimmed.indexOf('=');
    if(EqIndex <= 0)
      continue;

    const Key = Trimmed.slice(0, EqIndex).trim();
    if(!Key || process.env[Key] !== undefined)
      continue;

    let Value = Trimmed.slice(EqIndex + 1).trim();
    if((Value.startsWith('"') && Value.endsWith('"')) || (Value.startsWith("'") && Value.endsWith("'")))
      Value = Value.slice(1, -1);

    process.env[Key] = Value;
  }
}

module.exports = { LoadEnvFile };
