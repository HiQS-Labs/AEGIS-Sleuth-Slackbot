
// import required modules.
const fs = require('fs');
const fsPromises = fs.promises;
const crypto = require('crypto');
const path = require('path');

// define token expiry durations.
const SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000;
const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000;

// define password hashing size.
const PASSWORD_HASH_BYTE_LENGTH = 64;

/**
 * @typedef {Object} AdminAuthConfig
 * @property {string} adminEmail Admin email address.
 * @property {string} [adminBaseUrl] Canonical base URL for admin links.
 * @property {string} passwordHash Hex-encoded password hash.
 * @property {string} passwordSalt Hex-encoded password salt.
 * @property {{
 *   host: string,
 *   port: number,
 *   secure: boolean,
 *   authUser: string,
 *   authPassEncrypted: string
 * }} [smtp] SMTP settings.
 */

/**
 * Provides admin credential, session, and password-reset helpers.
 */
class AdminAuth {
  /**
   * Path to admin auth config file.
   * @type {string}
   */
  #ConfigFilePath;

  /**
   * Loaded admin auth config.
   * @type {AdminAuthConfig|null}
   */
  #AuthConfig = null;

  /**
   * Map of session token to expiry timestamp (ms since epoch).
   * @type {Map<string, number>}
   */
  #SessionTokensByValue = new Map();

  /**
   * Map of password reset token to expiry timestamp (ms since epoch).
   * @type {Map<string, number>}
   */
  #PasswordResetTokensByValue = new Map();

  /**
   * Initialize a new instance.
   */
  constructor() {
    this.#ConfigFilePath = AdminAuth.GetConfigFilePath();
  }

  /**
   * Get absolute path to admin auth config.
   * @returns {string}
   */
  static GetConfigFilePath() {
    return path.resolve(path.join(__dirname, '..', 'data', 'runtime', 'admin-auth.json'));
  }

  /**
   * Create a password hash and salt using scrypt.
   * @param {string} ArgPassword Password to hash.
   * @param {string|null} [ArgSaltHex] Optional existing salt.
   * @returns {{ PasswordHash: string, PasswordSalt: string }}
   */
  static CreatePasswordHash(ArgPassword, ArgSaltHex = null) {
    if(typeof ArgPassword !== 'string' || ArgPassword.length === 0)
      throw new Error('Password is required.');

    const PasswordSalt = ArgSaltHex ?? crypto.randomBytes(32).toString('hex');
    const HashBuffer = crypto.scryptSync(ArgPassword, PasswordSalt, PASSWORD_HASH_BYTE_LENGTH);
    return {
      PasswordHash: HashBuffer.toString('hex'),
      PasswordSalt
    };
  }

  /**
   * Verify a password against a stored hash and salt.
   * @param {string} ArgPassword Password to verify.
   * @param {string} ArgHashHex Stored hash.
   * @param {string} ArgSaltHex Stored salt.
   * @returns {boolean}
   */
  static VerifyPassword(ArgPassword, ArgHashHex, ArgSaltHex) {
    if(typeof ArgPassword !== 'string') return false;
    if(typeof ArgHashHex !== 'string' || !/^[0-9a-f]+$/i.test(ArgHashHex) || ArgHashHex.length % 2 !== 0) return false;
    if(typeof ArgSaltHex !== 'string' || ArgSaltHex.length === 0) return false;

    const StoredHashBuffer = Buffer.from(ArgHashHex, 'hex');
    if(StoredHashBuffer.length === 0) return false;

    const DerivedHashBuffer = crypto.scryptSync(ArgPassword, ArgSaltHex, StoredHashBuffer.length);
    if(DerivedHashBuffer.length !== StoredHashBuffer.length) return false;
    return crypto.timingSafeEqual(StoredHashBuffer, DerivedHashBuffer);
  }

  /**
   * Encrypt a secret string using AES-256-GCM.
   * @param {string} ArgPlainText Plaintext value.
   * @param {string|undefined} [ArgEncryptionKeyHex] Optional encryption key override.
   * @returns {string}
   */
  static EncryptSecret(ArgPlainText, ArgEncryptionKeyHex = undefined) {
    if(typeof ArgPlainText !== 'string' || ArgPlainText.length === 0)
      throw new Error('Plaintext value is required.');

    const KeyBuffer = this.#GetEncryptionKeyBuffer(ArgEncryptionKeyHex);
    const IvBuffer = crypto.randomBytes(12);
    const Cipher = crypto.createCipheriv('aes-256-gcm', KeyBuffer, IvBuffer);
    const CipherTextBuffer = Buffer.concat([Cipher.update(ArgPlainText, 'utf8'), Cipher.final()]);
    const AuthTagBuffer = Cipher.getAuthTag();
    return `${IvBuffer.toString('hex')}:${AuthTagBuffer.toString('hex')}:${CipherTextBuffer.toString('hex')}`;
  }

  /**
   * Decrypt a value produced by EncryptSecret().
   * @param {string} ArgCipherText Encrypted payload.
   * @param {string|undefined} [ArgEncryptionKeyHex] Optional encryption key override.
   * @returns {string}
   */
  static DecryptSecret(ArgCipherText, ArgEncryptionKeyHex = undefined) {
    if(typeof ArgCipherText !== 'string' || ArgCipherText.length === 0)
      throw new Error('Encrypted value is required.');

    const Parts = ArgCipherText.split(':');
    if(Parts.length !== 3)
      throw new Error('Encrypted value format is invalid.');

    const IvBuffer = Buffer.from(Parts[0], 'hex');
    const AuthTagBuffer = Buffer.from(Parts[1], 'hex');
    const CipherTextBuffer = Buffer.from(Parts[2], 'hex');
    const KeyBuffer = this.#GetEncryptionKeyBuffer(ArgEncryptionKeyHex);

    const Decipher = crypto.createDecipheriv('aes-256-gcm', KeyBuffer, IvBuffer);
    Decipher.setAuthTag(AuthTagBuffer);
    const PlainTextBuffer = Buffer.concat([Decipher.update(CipherTextBuffer), Decipher.final()]);
    return PlainTextBuffer.toString('utf8');
  }

  /**
   * Return true when the admin auth file exists.
   * @returns {Promise<boolean>}
   */
  async IsConfiguredAsync() {
    try {
      await fsPromises.access(this.#ConfigFilePath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Force a reload of config from disk.
   * @returns {Promise<void>}
   */
  async LoadConfigAsync() {
    this.#AuthConfig = null;
    await this.#GetConfigAsync();
  }

  /**
   * Get configured admin email.
   * @returns {Promise<string>}
   */
  async GetAdminEmailAsync() {
    const Config = await this.#GetConfigAsync();
    return Config.adminEmail;
  }

  /**
   * Get configured admin base URL.
   * @returns {Promise<string>}
   */
  async GetAdminBaseUrlAsync() {
    const Config = await this.#GetConfigAsync();
    return typeof Config.adminBaseUrl === 'string' ? Config.adminBaseUrl.trim() : '';
  }

  /**
   * Check whether an email matches configured admin email.
   * @param {string} ArgEmail Email to compare.
   * @returns {Promise<boolean>}
   */
  async DoesEmailMatchConfiguredAdminAsync(ArgEmail) {
    if(typeof ArgEmail !== 'string' || ArgEmail.trim().length === 0) return false;
    const Config = await this.#GetConfigAsync();
    return ArgEmail.trim().toLowerCase() === Config.adminEmail.toLowerCase();
  }

  /**
   * Validate login credentials.
   * @param {string} ArgEmail Email value from login request.
   * @param {string} ArgPassword Password value from login request.
   * @returns {Promise<boolean>}
   */
  async ValidateCredentialsAsync(ArgEmail, ArgPassword) {
    try {
      const Config = await this.#GetConfigAsync();
      const PasswordMatches = AdminAuth.VerifyPassword(ArgPassword, Config.passwordHash, Config.passwordSalt);
      const EmailMatches = typeof ArgEmail === 'string' && ArgEmail.trim().toLowerCase() === Config.adminEmail.toLowerCase();
      return EmailMatches && PasswordMatches;
    } catch {
      return false;
    }
  }

  /**
   * Create a new session token and store it in memory.
   * @returns {string}
   */
  CreateSessionToken() {
    this.#PurgeExpiredSessionTokens();
    const SessionToken = crypto.randomBytes(32).toString('hex');
    const ExpiryTimestamp = Date.now() + SESSION_EXPIRY_MS;
    this.#SessionTokensByValue.set(SessionToken, ExpiryTimestamp);
    return SessionToken;
  }

  /**
   * Validate a session token and refresh expiry on success.
   * @param {string} ArgSessionToken Session token string.
   * @returns {boolean}
   */
  ValidateSessionToken(ArgSessionToken) {
    if(typeof ArgSessionToken !== 'string' || ArgSessionToken.length === 0) return false;

    this.#PurgeExpiredSessionTokens();
    const ExpiryTimestamp = this.#SessionTokensByValue.get(ArgSessionToken);
    if(!ExpiryTimestamp) return false;
    if(ExpiryTimestamp <= Date.now()) {
      this.#SessionTokensByValue.delete(ArgSessionToken);
      return false;
    }

    this.#SessionTokensByValue.set(ArgSessionToken, Date.now() + SESSION_EXPIRY_MS);
    return true;
  }

  /**
   * Invalidate a single session token.
   * @param {string} ArgSessionToken Session token string.
   * @returns {void}
   */
  InvalidateSessionToken(ArgSessionToken) {
    if(typeof ArgSessionToken !== 'string' || ArgSessionToken.length === 0) return;
    this.#SessionTokensByValue.delete(ArgSessionToken);
  }

  /**
   * Invalidate all session tokens.
   * @returns {void}
   */
  InvalidateAllSessions() {
    this.#SessionTokensByValue.clear();
  }

  /**
   * Create a password-reset token.
   * @returns {string}
   */
  CreatePasswordResetToken() {
    this.#PurgeExpiredPasswordResetTokens();
    const ResetToken = crypto.randomBytes(32).toString('hex');
    this.#PasswordResetTokensByValue.set(ResetToken, Date.now() + RESET_TOKEN_EXPIRY_MS);
    return ResetToken;
  }

  /**
   * Validate and consume a password-reset token.
   * @param {string} ArgResetToken Reset token string.
   * @returns {boolean}
   */
  ConsumePasswordResetToken(ArgResetToken) {
    if(typeof ArgResetToken !== 'string' || ArgResetToken.length === 0) return false;

    this.#PurgeExpiredPasswordResetTokens();
    const ExpiryTimestamp = this.#PasswordResetTokensByValue.get(ArgResetToken);
    this.#PasswordResetTokensByValue.delete(ArgResetToken);
    if(!ExpiryTimestamp) return false;
    return ExpiryTimestamp > Date.now();
  }

  /**
   * Update stored password hash and invalidate all sessions.
   * @param {string} ArgNewPassword New password value.
   * @returns {Promise<void>}
   */
  async SetPasswordAsync(ArgNewPassword) {
    if(typeof ArgNewPassword !== 'string' || ArgNewPassword.length === 0)
      throw new Error('New password is required.');

    const Config = await this.#GetConfigAsync();
    const PasswordData = AdminAuth.CreatePasswordHash(ArgNewPassword);
    Config.passwordHash = PasswordData.PasswordHash;
    Config.passwordSalt = PasswordData.PasswordSalt;
    await this.#SaveConfigAsync(Config);

    this.#PasswordResetTokensByValue.clear();
    this.InvalidateAllSessions();
  }

  /**
   * Get SMTP settings with decrypted password.
   * @returns {Promise<{ host: string, port: number, secure: boolean, authUser: string, authPass: string, fromEmail: string }>}
   */
  async GetSmtpSettingsAsync() {
    const Config = await this.#GetConfigAsync();
    if(!Config.smtp)
      throw new Error('SMTP configuration is missing.');

    const HostValue = Config.smtp.host;
    const PortValue = Config.smtp.port;
    const SecureValue = Config.smtp.secure;
    const AuthUserValue = Config.smtp.authUser;
    const EncryptedPassValue = Config.smtp.authPassEncrypted;

    if(typeof HostValue !== 'string' || HostValue.length === 0) throw new Error('SMTP host is invalid.');
    if(typeof PortValue !== 'number' || !Number.isFinite(PortValue)) throw new Error('SMTP port is invalid.');
    if(typeof AuthUserValue !== 'string' || AuthUserValue.length === 0) throw new Error('SMTP user is invalid.');
    if(typeof EncryptedPassValue !== 'string' || EncryptedPassValue.length === 0)
      throw new Error('SMTP password is not configured.');

    const AuthPass = AdminAuth.DecryptSecret(EncryptedPassValue);
    return {
      host: HostValue,
      port: PortValue,
      secure: SecureValue === true,
      authUser: AuthUserValue,
      authPass: AuthPass,
      fromEmail: Config.adminEmail
    };
  }

  /**
   * Get loaded config or load it from disk.
   * @returns {Promise<AdminAuthConfig>}
   */
  async #GetConfigAsync() {
    if(this.#AuthConfig) return this.#AuthConfig;

    const IsConfigured = await this.IsConfiguredAsync();
    if(!IsConfigured)
      throw new Error('Admin auth is not configured. Run "npm run admin:setup".');

    const FileContents = await fsPromises.readFile(this.#ConfigFilePath, 'utf8');
    const ParsedConfig = JSON.parse(FileContents);
    if(!ParsedConfig || typeof ParsedConfig !== 'object')
      throw new Error('Admin auth config format is invalid.');

    const AdminEmailValue = ParsedConfig.adminEmail;
    const PasswordHashValue = ParsedConfig.passwordHash;
    const PasswordSaltValue = ParsedConfig.passwordSalt;
    if(typeof AdminEmailValue !== 'string' || AdminEmailValue.length === 0)
      throw new Error('adminEmail is missing in admin auth config.');
    if(typeof PasswordHashValue !== 'string' || PasswordHashValue.length === 0)
      throw new Error('passwordHash is missing in admin auth config.');
    if(typeof PasswordSaltValue !== 'string' || PasswordSaltValue.length === 0)
      throw new Error('passwordSalt is missing in admin auth config.');

    this.#AuthConfig = /** @type {AdminAuthConfig} */ (ParsedConfig);
    return this.#AuthConfig;
  }

  /**
   * Save config to disk and update memory cache.
   * @param {AdminAuthConfig} ArgConfig Config object to persist.
   * @returns {Promise<void>}
   */
  async #SaveConfigAsync(ArgConfig) {
    const DirPath = path.dirname(this.#ConfigFilePath);
    await fsPromises.mkdir(DirPath, { recursive: true });
    const FileContents = JSON.stringify(ArgConfig, null, 2);
    await fsPromises.writeFile(this.#ConfigFilePath, FileContents, 'utf8');
    this.#AuthConfig = ArgConfig;
  }

  /**
   * Remove expired session tokens.
   * @returns {void}
   */
  #PurgeExpiredSessionTokens() {
    const CurrentTimestamp = Date.now();
    for(const [SessionToken, ExpiryTimestamp] of this.#SessionTokensByValue.entries()) {
      if(ExpiryTimestamp <= CurrentTimestamp)
        this.#SessionTokensByValue.delete(SessionToken);
    }
  }

  /**
   * Remove expired password-reset tokens.
   * @returns {void}
   */
  #PurgeExpiredPasswordResetTokens() {
    const CurrentTimestamp = Date.now();
    for(const [ResetToken, ExpiryTimestamp] of this.#PasswordResetTokensByValue.entries()) {
      if(ExpiryTimestamp <= CurrentTimestamp)
        this.#PasswordResetTokensByValue.delete(ResetToken);
    }
  }

  /**
   * Parse and validate encryption key.
   * @param {string|undefined} ArgEncryptionKeyHex Encryption key hex string.
   * @returns {Buffer}
   */
  static #GetEncryptionKeyBuffer(ArgEncryptionKeyHex) {
    const KeyHex = typeof ArgEncryptionKeyHex === 'string' && ArgEncryptionKeyHex.length > 0
      ? ArgEncryptionKeyHex
      : process.env.ADMIN_ENCRYPTION_KEY;

    if(typeof KeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(KeyHex))
      throw new Error('ADMIN_ENCRYPTION_KEY must be set to a 32-byte hex string.');

    return Buffer.from(KeyHex, 'hex');
  }
}

// export the class.
module.exports = AdminAuth;
