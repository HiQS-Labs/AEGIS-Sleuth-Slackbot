/**
 * Validates AI prompt instruction files and their associated JSON schemas.
 *
 * Checks performed:
 * - All expected instruction and schema files exist and are non-empty.
 * - Schema files contain valid JSON.
 * - Schemas have the fields required by OpenAI structured output (strict, additionalProperties, required).
 * - Every instruction file (except chat) has a matching schema file.
 *
 * Exit code 0 = all checks pass, exit code 1 = one or more failures.
 *
 * Usage: node scripts/validate-ai-prompts.js
 */

const fs = require('fs');
const path = require('path');

const AI_DIR = path.join(__dirname, '..', 'data', 'static', 'ai');

// expected instruction + schema pairs (instruction file → schema file, null = no schema expected).
const EXPECTED_PAIRS = {
  'reminders-instructions.md': 'reminders-schema.json',
  'manual-reminder-task-instructions.md': 'manual-reminder-task-schema.json',
  'date-extraction-instructions.md': 'date-extraction-schema.json',
  'reminders-dedup-instructions.md': 'reminders-dedup-schema.json',
  'github-relay-relevance-instructions.md': 'github-relay-relevance-schema.json',
  'rmm-instructions.md': 'rmm-schema.json',
  'code-task-synthesis-instructions.md': 'code-task-synthesis-schema.json',
  'chat-instructions.md': null, // chat has no structured output schema.
};

let FailCount = 0;

function Fail(Message) {
  console.error(`  FAIL: ${Message}`);
  FailCount++;
}

function Pass(Message) {
  console.log(`  OK:   ${Message}`);
}

// check that all expected files exist and are non-empty.
console.log('\n--- checking expected files exist and are non-empty ---');
for (const [InstructionFile, SchemaFile] of Object.entries(EXPECTED_PAIRS)) {
  const InstructionPath = path.join(AI_DIR, InstructionFile);
  if (!fs.existsSync(InstructionPath)) {
    Fail(`missing instruction file: ${InstructionFile}`);
  } else if (fs.statSync(InstructionPath).size === 0) {
    Fail(`empty instruction file: ${InstructionFile}`);
  } else {
    Pass(InstructionFile);
  }

  if (SchemaFile) {
    const SchemaPath = path.join(AI_DIR, SchemaFile);
    if (!fs.existsSync(SchemaPath)) {
      Fail(`missing schema file: ${SchemaFile}`);
    } else if (fs.statSync(SchemaPath).size === 0) {
      Fail(`empty schema file: ${SchemaFile}`);
    } else {
      Pass(SchemaFile);
    }
  }
}

// validate each schema file.
console.log('\n--- validating schema files ---');
for (const [, SchemaFile] of Object.entries(EXPECTED_PAIRS)) {
  if (!SchemaFile) continue;

  const SchemaPath = path.join(AI_DIR, SchemaFile);
  if (!fs.existsSync(SchemaPath)) continue; // already reported above.

  let Parsed;
  try {
    Parsed = JSON.parse(fs.readFileSync(SchemaPath, 'utf8'));
  } catch (error) {
    Fail(`${SchemaFile}: invalid JSON — ${error.message}`);
    continue;
  }

  // check top-level fields required by OpenAI structured output.
  if (Parsed.strict !== true) {
    Fail(`${SchemaFile}: missing or false "strict" (OpenAI structured output requires strict: true)`);
  } else {
    Pass(`${SchemaFile}: strict: true`);
  }

  if (!Parsed.name || typeof Parsed.name !== 'string') {
    Fail(`${SchemaFile}: missing "name" field`);
  } else {
    Pass(`${SchemaFile}: name: "${Parsed.name}"`);
  }

  // check inner schema object.
  const InnerSchema = Parsed.schema;
  if (!InnerSchema || typeof InnerSchema !== 'object') {
    Fail(`${SchemaFile}: missing "schema" object`);
    continue;
  }

  if (InnerSchema.additionalProperties !== false) {
    Fail(`${SchemaFile}: schema.additionalProperties must be false (OpenAI structured output requirement)`);
  } else {
    Pass(`${SchemaFile}: additionalProperties: false`);
  }

  if (!Array.isArray(InnerSchema.required) || InnerSchema.required.length === 0) {
    Fail(`${SchemaFile}: schema.required must be a non-empty array`);
  } else {
    Pass(`${SchemaFile}: required fields: [${InnerSchema.required.join(', ')}]`);
  }

  // check that every property listed in required actually exists in properties.
  if (InnerSchema.properties && Array.isArray(InnerSchema.required)) {
    for (const Field of InnerSchema.required) {
      if (!InnerSchema.properties[Field]) {
        Fail(`${SchemaFile}: required field "${Field}" not found in properties`);
      }
    }
  }
}

// summary.
console.log('\n--- summary ---');
if (FailCount > 0) {
  console.error(`${FailCount} check(s) failed.\n`);
  process.exit(1);
} else {
  console.log('All checks passed.\n');
  process.exit(0);
}
