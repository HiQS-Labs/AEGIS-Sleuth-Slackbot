#!/usr/bin/env node

/**
 * Web-based admin setup server.
 * Serves a browser form to configure admin credentials without terminal prompts.
 *
 * Usage: node scripts/admin-setup-web.js
 *        npm run admin:setup:web
 *
 * Opens http://localhost:3333 — complete the form, then close this script.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const AdminAuth = require('../src/admin-auth');

const SETUP_PORT = 3333;
const PROJECT_DIR = path.resolve(path.join(__dirname, '..'));
const ENV_FILE_PATH = path.join(PROJECT_DIR, '.env');
const AUTH_CONFIG_PATH = AdminAuth.GetConfigFilePath();

// ensure encryption key exists before serving the form.
function EnsureEncryptionKey() {
  // check env var first.
  if(process.env.ADMIN_ENCRYPTION_KEY && /^[0-9a-f]{64}$/i.test(process.env.ADMIN_ENCRYPTION_KEY))
    return process.env.ADMIN_ENCRYPTION_KEY;

  // check .env file.
  if(fs.existsSync(ENV_FILE_PATH)) {
    const EnvContents = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    const KeyMatch = EnvContents.match(/^ADMIN_ENCRYPTION_KEY=([0-9a-f]{64})\s*$/im);
    if(KeyMatch) {
      process.env.ADMIN_ENCRYPTION_KEY = KeyMatch[1];
      return KeyMatch[1];
    }
  }

  // generate new key and save to .env.
  const NewKey = crypto.randomBytes(32).toString('hex');
  let EnvContents = '';
  if(fs.existsSync(ENV_FILE_PATH))
    EnvContents = fs.readFileSync(ENV_FILE_PATH, 'utf8').replace(/\n?ADMIN_ENCRYPTION_KEY=.*$/m, '');

  const Separator = EnvContents.length > 0 && !EnvContents.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(ENV_FILE_PATH, `${EnvContents}${Separator}ADMIN_ENCRYPTION_KEY=${NewKey}\n`, 'utf8');
  process.env.ADMIN_ENCRYPTION_KEY = NewKey;
  console.log(`Generated ADMIN_ENCRYPTION_KEY and saved to ${ENV_FILE_PATH}`);
  return NewKey;
}

// build the HTML setup page.
function BuildSetupPageHtml(ArgMessage = '', ArgIsError = false) {
  const AlreadyConfigured = fs.existsSync(AUTH_CONFIG_PATH);
  const StatusBanner = AlreadyConfigured
    ? '<div class="banner warn">admin-auth.json already exists. Submitting will overwrite it.</div>'
    : '';
  const MessageBanner = ArgMessage
    ? `<div class="banner ${ArgIsError ? 'error' : 'success'}">${ArgMessage}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sleuth Admin Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: #1e293b; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
    h1 { font-size: 1.5rem; margin-bottom: 8px; color: #f8fafc; }
    .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 24px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px; font-weight: 600; }
    label { display: block; font-size: 0.875rem; color: #cbd5e1; margin-bottom: 4px; }
    input[type="text"], input[type="password"], input[type="email"], input[type="url"] { width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.875rem; margin-bottom: 12px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #3b82f6; }
    input::placeholder { color: #475569; }
    .hint { font-size: 0.75rem; color: #64748b; margin-top: -8px; margin-bottom: 12px; }
    button { width: 100%; padding: 12px; background: #3b82f6; color: #fff; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #2563eb; }
    button:disabled { background: #475569; cursor: not-allowed; }
    .banner { padding: 10px 14px; border-radius: 6px; font-size: 0.875rem; margin-bottom: 16px; }
    .banner.success { background: #064e3b; color: #6ee7b7; border: 1px solid #065f46; }
    .banner.error { background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; }
    .banner.warn { background: #78350f; color: #fcd34d; border: 1px solid #92400e; }
    .divider { border: none; border-top: 1px solid #334155; margin: 20px 0; }
    .optional-label { color: #64748b; font-weight: normal; font-size: 0.75rem; }
    .footer { text-align: center; margin-top: 24px; font-size: 0.75rem; color: #475569; }
    .success-box { text-align: center; padding: 20px 0; }
    .success-box .check { font-size: 3rem; margin-bottom: 16px; }
    .success-box p { margin-bottom: 8px; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sleuth Admin Setup</h1>
    <p class="subtitle">Configure admin credentials for the web management panel.</p>
    ${StatusBanner}
    ${MessageBanner}
    <form method="POST" action="/setup" id="setupForm">
      <div class="section">
        <div class="section-title">Admin Account</div>
        <label for="email">Admin email</label>
        <input type="email" id="email" name="email" value="devops@neochro.me" placeholder="devops@neochro.me">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="Minimum 8 characters" minlength="8" required>
        <label for="confirmPassword">Confirm password</label>
        <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Re-enter password" minlength="8" required>
      </div>
      <div class="section">
        <div class="section-title">Base URL</div>
        <label for="baseUrl">Admin panel URL</label>
        <input type="url" id="baseUrl" name="baseUrl" value="http://localhost:2020" placeholder="http://localhost:2020">
        <div class="hint">Used for password reset links. Set to your production URL on the server.</div>
      </div>
      <hr class="divider">
      <div class="section">
        <div class="section-title">Gmail SMTP <span class="optional-label">(optional — for password reset emails)</span></div>
        <label for="smtpUser">Gmail address</label>
        <input type="email" id="smtpUser" name="smtpUser" placeholder="devops@neochro.me">
        <div class="hint">Leave blank to skip SMTP setup. You can configure it later.</div>
        <label for="smtpPassword">Gmail App Password</label>
        <input type="password" id="smtpPassword" name="smtpPassword" placeholder="16-character App Password from Google">
        <div class="hint">Generate at myaccount.google.com/apppasswords (requires 2FA).</div>
      </div>
      <button type="submit" id="submitBtn">Save Configuration</button>
    </form>
    <div class="footer">Encryption key auto-generated and saved to .env</div>
  </div>
  <script>
    document.getElementById('setupForm').addEventListener('submit', function(e) {
      var pw = document.getElementById('password').value;
      var cpw = document.getElementById('confirmPassword').value;
      if(pw.length < 8) { e.preventDefault(); alert('Password must be at least 8 characters.'); return; }
      if(pw !== cpw) { e.preventDefault(); alert('Passwords do not match.'); return; }
      document.getElementById('submitBtn').disabled = true;
      document.getElementById('submitBtn').textContent = 'Saving...';
    });
  </script>
</body>
</html>`;
}

// build the success page HTML.
function BuildSuccessPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sleuth Admin Setup - Complete</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: #1e293b; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.4); text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; color: #f8fafc; }
    .check { font-size: 3rem; margin-bottom: 16px; }
    p { margin-bottom: 12px; color: #94a3b8; font-size: 0.875rem; line-height: 1.6; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; color: #e2e8f0; }
    .file-path { background: #0f172a; padding: 10px 14px; border-radius: 6px; font-size: 0.8rem; color: #6ee7b7; margin: 16px 0; word-break: break-all; text-align: left; }
    .steps { text-align: left; margin: 20px 0; }
    .steps li { margin-bottom: 8px; color: #cbd5e1; font-size: 0.875rem; }
    .banner { padding: 10px 14px; border-radius: 6px; font-size: 0.875rem; margin-bottom: 16px; background: #064e3b; color: #6ee7b7; border: 1px solid #065f46; }
  </style>
</head>
<body>
  <div class="container">
    <div class="check">&#10003;</div>
    <h1>Setup Complete</h1>
    <div class="banner">Admin credentials saved successfully.</div>
    <div class="file-path">${AUTH_CONFIG_PATH}</div>
    <p>Next steps:</p>
    <ol class="steps">
      <li>Close this setup server (<code>Ctrl+C</code> in terminal)</li>
      <li>Start the app: <code>npm run dev</code></li>
      <li>Open the admin panel: <code>http://localhost:2020/admin/</code></li>
    </ol>
    <p style="margin-top: 20px; color: #64748b; font-size: 0.75rem;">
      Encryption key: <code>.env</code> &nbsp;|&nbsp; Auth config: <code>data/runtime/admin-auth.json</code>
    </p>
  </div>
</body>
</html>`;
}

// parse URL-encoded form body.
function ParseFormBody(ArgBodyString) {
  const Result = {};
  for(const Pair of ArgBodyString.split('&')) {
    const [Key, ...ValueParts] = Pair.split('=');
    Result[decodeURIComponent(Key)] = decodeURIComponent(ValueParts.join('=').replace(/\+/g, ' '));
  }
  return Result;
}

// handle the setup form submission.
function HandleSetupPost(ArgBodyString) {
  const FormData = ParseFormBody(ArgBodyString);
  const AdminEmail = (FormData.email || '').trim() || 'devops@neochro.me';
  const Password = FormData.password || '';
  const ConfirmPassword = FormData.confirmPassword || '';
  const BaseUrl = (FormData.baseUrl || '').trim() || 'http://localhost:2020';
  const SmtpUser = (FormData.smtpUser || '').trim();
  const SmtpPassword = (FormData.smtpPassword || '').trim();

  // validate password.
  if(Password.length < 8)
    return { ok: false, error: 'Password must be at least 8 characters.' };

  if(Password !== ConfirmPassword)
    return { ok: false, error: 'Passwords do not match.' };

  // hash password.
  const PasswordData = AdminAuth.CreatePasswordHash(Password);
  const Config = {
    adminEmail: AdminEmail,
    adminBaseUrl: BaseUrl.replace(/\/+$/, ''),
    passwordHash: PasswordData.PasswordHash,
    passwordSalt: PasswordData.PasswordSalt
  };

  // add SMTP config if provided.
  if(SmtpUser.length > 0 && SmtpPassword.length > 0) {
    const EncryptedSmtpPass = AdminAuth.EncryptSecret(SmtpPassword, process.env.ADMIN_ENCRYPTION_KEY);
    Config.smtp = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      authUser: SmtpUser,
      authPassEncrypted: EncryptedSmtpPass
    };
  }

  // write config to disk.
  const DirPath = path.dirname(AUTH_CONFIG_PATH);
  fs.mkdirSync(DirPath, { recursive: true });
  fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(Config, null, 2), 'utf8');
  return { ok: true };
}

// main server.
function StartSetupServer() {
  const EncryptionKey = EnsureEncryptionKey();
  console.log('');
  console.log('=== Sleuth Admin Web Setup ===');
  console.log('');
  console.log(`Encryption key: ${EncryptionKey.substring(0, 8)}...${EncryptionKey.substring(56)} (saved in .env)`);
  console.log('');

  const Server = http.createServer((ArgReq, ArgRes) => {
    if(ArgReq.method === 'GET' && (ArgReq.url === '/' || ArgReq.url === '/setup')) {
      ArgRes.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      ArgRes.end(BuildSetupPageHtml());
      return;
    }

    if(ArgReq.method === 'POST' && ArgReq.url === '/setup') {
      let BodyChunks = '';
      ArgReq.on('data', (ArgChunk) => { BodyChunks += ArgChunk.toString(); });
      ArgReq.on('end', () => {
        const Result = HandleSetupPost(BodyChunks);
        if(Result.ok) {
          console.log(`Admin config saved: ${AUTH_CONFIG_PATH}`);
          console.log('');
          console.log('Setup complete. You can close this server (Ctrl+C) and start the app with: npm run dev');
          ArgRes.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          ArgRes.end(BuildSuccessPageHtml());
        } else {
          ArgRes.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          ArgRes.end(BuildSetupPageHtml(Result.error, true));
        }
      });
      return;
    }

    ArgRes.writeHead(302, { 'Location': '/' });
    ArgRes.end();
  });

  Server.on('error', (ArgError) => {
    if(ArgError.code === 'EADDRINUSE') {
      console.error(`Port ${SETUP_PORT} is already in use. Either:`);
      console.error(`  - Close the other process using port ${SETUP_PORT}`);
      console.error(`  - Or open http://localhost:${SETUP_PORT} if setup is already running`);
      process.exit(1);
    }
    throw ArgError;
  });

  Server.listen(SETUP_PORT, () => {
    const SetupUrl = `http://localhost:${SETUP_PORT}`;
    console.log(`Setup server running at: ${SetupUrl}`);
    console.log('Open this URL in your browser to configure admin credentials.');
    console.log('Press Ctrl+C to stop.');
    console.log('');

    // try to open browser automatically.
    const OpenCommand = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start' : 'xdg-open';
    require('child_process').exec(`${OpenCommand} ${SetupUrl}`, () => {});
  });
}

// run.
StartSetupServer();
