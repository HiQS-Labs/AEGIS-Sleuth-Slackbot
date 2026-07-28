#!/usr/bin/env node

// import required modules.
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const AdminAuth = require('../src/admin-auth');

// define defaults used by setup prompts.
const DEFAULT_ADMIN_EMAIL = 'devops@neochro.me';
const DEFAULT_ADMIN_BASE_URL = 'http://localhost:2020';

/**
 * Create readline interface.
 * @returns {readline.Interface}
 */
function CreateReadlineInterface() {
  const MutableOutput = {
    muted: false,
    write(ArgChunk, ArgEncoding, ArgCallback) {
      if(!this.muted)
        return process.stdout.write(ArgChunk, ArgEncoding, ArgCallback);

      if(typeof ArgCallback === 'function')
        ArgCallback();

      return true;
    },
    isTTY: process.stdout.isTTY,
    columns: process.stdout.columns,
  };

  return readline.createInterface({
    input: process.stdin,
    output: MutableOutput,
    terminal: true,
  });
}

/**
 * Prompt user and resolve with entered value.
 * @param {readline.Interface} ArgReadline Readline interface.
 * @param {string} ArgQuestion Prompt text.
 * @returns {Promise<string>}
 */
function AskQuestionAsync(ArgReadline, ArgQuestion) {
  return new Promise(ArgResolve => {
    ArgReadline.question(ArgQuestion, ArgAnswer => ArgResolve(ArgAnswer));
  });
}

/**
 * Prompt user for hidden input without echoing the entered value.
 * @param {readline.Interface} ArgReadline Readline interface.
 * @param {string} ArgQuestion Prompt text.
 * @returns {Promise<string>}
 */
function AskHiddenQuestionAsync(ArgReadline, ArgQuestion) {
  return new Promise(ArgResolve => {
    const Output = /** @type {{ muted?: boolean }} */ (ArgReadline.output);
    process.stdout.write(ArgQuestion);
    Output.muted = true;
    ArgReadline.question('', ArgAnswer => {
      Output.muted = false;
      process.stdout.write('\n');
      ArgResolve(ArgAnswer);
    });
  });
}

/**
 * Prompt user with default value.
 * @param {readline.Interface} ArgReadline Readline interface.
 * @param {string} ArgLabel Prompt label.
 * @param {string} ArgDefaultValue Default value.
 * @returns {Promise<string>}
 */
async function PromptWithDefaultAsync(ArgReadline, ArgLabel, ArgDefaultValue) {
  const PromptText = `${ArgLabel} [${ArgDefaultValue}]: `;
  const RawValue = await AskQuestionAsync(ArgReadline, PromptText);
  const TrimmedValue = RawValue.trim();
  return TrimmedValue.length > 0 ? TrimmedValue : ArgDefaultValue;
}

/**
 * Prompt user for a required value.
 * @param {readline.Interface} ArgReadline Readline interface.
 * @param {string} ArgPrompt Prompt text.
 * @returns {Promise<string>}
 */
async function PromptRequiredAsync(ArgReadline, ArgPrompt) {
  while(true) {
    const RawValue = await AskQuestionAsync(ArgReadline, ArgPrompt);
    const TrimmedValue = RawValue.trim();
    if(TrimmedValue.length > 0)
      return TrimmedValue;

    console.log('Value is required.');
  }
}

/**
 * Prompt user for an optional hidden value.
 * @param {readline.Interface} ArgReadline Readline interface.
 * @param {string} ArgPrompt Prompt text.
 * @returns {Promise<string>}
 */
async function PromptOptionalHiddenAsync(ArgReadline, ArgPrompt) {
  const RawValue = await AskHiddenQuestionAsync(ArgReadline, ArgPrompt);
  return RawValue.trim();
}

/**
 * Prompt user for a required hidden value.
 * @param {readline.Interface} ArgReadline Readline interface.
 * @param {string} ArgPrompt Prompt text.
 * @returns {Promise<string>}
 */
async function PromptRequiredHiddenAsync(ArgReadline, ArgPrompt) {
  while(true) {
    const TrimmedValue = await PromptOptionalHiddenAsync(ArgReadline, ArgPrompt);
    if(TrimmedValue.length > 0)
      return TrimmedValue;

    console.log('Value is required.');
  }
}

/**
 * Prompt user for password and confirmation.
 * @param {readline.Interface} ArgReadline Readline interface.
 * @returns {Promise<string>}
 */
async function PromptPasswordWithConfirmationAsync(ArgReadline) {
  while(true) {
    const PasswordValue = await PromptRequiredHiddenAsync(ArgReadline, 'Admin password: ');
    if(PasswordValue.length < 8) {
      console.log('Password must be at least 8 characters.');
      continue;
    }

    const ConfirmPasswordValue = await PromptRequiredHiddenAsync(ArgReadline, 'Confirm admin password: ');
    if(PasswordValue !== ConfirmPasswordValue) {
      console.log('Passwords do not match.');
      continue;
    }

    return PasswordValue;
  }
}

/**
 * Write admin auth config to disk.
 * @param {object} ArgConfig Config object to persist.
 * @returns {Promise<void>}
 */
async function WriteAdminConfigAsync(ArgConfig) {
  const ConfigPath = AdminAuth.GetConfigFilePath();
  const DirPath = path.dirname(ConfigPath);
  await fs.mkdir(DirPath, { recursive: true });
  await fs.writeFile(ConfigPath, JSON.stringify(ArgConfig, null, 2), 'utf8');
}

/**
 * Build admin config object for first-time setup.
 * @param {{
 *   AdminEmail: string,
 *   AdminPassword: string,
 *   AdminBaseUrl: string,
 *   SmtpUser?: string,
 *   SmtpAppPassword?: string,
 *   EncryptionKey: string,
 * }} ArgOptions Setup inputs.
 * @returns {object}
 */
function BuildAdminConfigValue(ArgOptions) {
  const PasswordData = AdminAuth.CreatePasswordHash(ArgOptions.AdminPassword);
  const ConfigValue = {
    adminEmail: ArgOptions.AdminEmail,
    adminBaseUrl: ArgOptions.AdminBaseUrl.replace(/\/+$/, ''),
    passwordHash: PasswordData.PasswordHash,
    passwordSalt: PasswordData.PasswordSalt,
  };

  if(typeof ArgOptions.SmtpAppPassword === 'string' && ArgOptions.SmtpAppPassword.length > 0) {
    const EncryptedSmtpPassword = AdminAuth.EncryptSecret(ArgOptions.SmtpAppPassword, ArgOptions.EncryptionKey);
    ConfigValue.smtp = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      authUser: ArgOptions.SmtpUser || ArgOptions.AdminEmail,
      authPassEncrypted: EncryptedSmtpPassword
    };
  }

  return ConfigValue;
}

/**
 * Run first-time admin setup flow.
 * @returns {Promise<void>}
 */
async function RunInitialSetupAsync() {
  const EncryptionKey = process.env.ADMIN_ENCRYPTION_KEY;
  if(typeof EncryptionKey !== 'string' || !/^[0-9a-f]{64}$/i.test(EncryptionKey))
    throw new Error('ADMIN_ENCRYPTION_KEY must be set to a 32-byte hex string before setup.');

  const Readline = CreateReadlineInterface();
  try {
    console.log('Sleuth admin setup\n');
    const AdminEmail = await PromptWithDefaultAsync(Readline, 'Admin email', DEFAULT_ADMIN_EMAIL);
    const AdminPassword = await PromptPasswordWithConfirmationAsync(Readline);
    const AdminBaseUrl = await PromptWithDefaultAsync(Readline, 'Admin base URL', DEFAULT_ADMIN_BASE_URL);
    console.log('Press Enter to skip Gmail SMTP setup for now.');
    const SmtpAppPassword = await PromptOptionalHiddenAsync(Readline, 'Gmail App Password (optional): ');
    const SmtpUser = SmtpAppPassword.length > 0
      ? await PromptWithDefaultAsync(Readline, 'Gmail SMTP user', AdminEmail)
      : '';
    const ConfigValue = BuildAdminConfigValue({
      AdminEmail,
      AdminPassword,
      AdminBaseUrl,
      SmtpUser,
      SmtpAppPassword,
      EncryptionKey,
    });

    await WriteAdminConfigAsync(ConfigValue);
    console.log(`\nSaved admin config: ${AdminAuth.GetConfigFilePath()}`);
  } finally {
    Readline.close();
  }
}

/**
 * Run CLI password-reset flow.
 * @returns {Promise<void>}
 */
async function RunPasswordResetAsync() {
  const ConfigPath = AdminAuth.GetConfigFilePath();
  const FileContents = await fs.readFile(ConfigPath, 'utf8');
  const ConfigValue = JSON.parse(FileContents);

  if(!ConfigValue || typeof ConfigValue !== 'object')
    throw new Error('admin-auth.json format is invalid.');

  const Readline = CreateReadlineInterface();
  try {
    console.log('Sleuth admin password reset\n');
    const NewPassword = await PromptPasswordWithConfirmationAsync(Readline);
    const PasswordData = AdminAuth.CreatePasswordHash(NewPassword);
    ConfigValue.passwordHash = PasswordData.PasswordHash;
    ConfigValue.passwordSalt = PasswordData.PasswordSalt;
    await WriteAdminConfigAsync(ConfigValue);
    console.log(`\nPassword updated: ${ConfigPath}`);
  } finally {
    Readline.close();
  }
}

/**
 * Execute CLI entrypoint.
 * @returns {Promise<void>}
 */
async function MainAsync() {
  const IsResetPasswordMode = process.argv.includes('--reset-password');
  if(IsResetPasswordMode) {
    await RunPasswordResetAsync();
    return;
  }

  await RunInitialSetupAsync();
}

if(require.main === module) {
  (async () => {
    try {
      await MainAsync();
    } catch(error) {
      console.error(`Setup failed: ${error.message}`);
      process.exit(1);
    }
  })();
}

module.exports = {
  BuildAdminConfigValue,
};
