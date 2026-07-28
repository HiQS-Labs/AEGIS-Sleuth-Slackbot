
// import required modules.
const fs = require('fs').promises;
const path = require('path');

/**
 * Provides simple key/value settings persisted to disk.
 */
class SettingsModule {
  /**
   * Path to the settings file on disk.
   * @type {string}
   */
  #SettingsFilePath;

  /**
   * Settings object.
   * @type {{ LastManualFilePath: string|null }}
   */
  Settings = { LastManualFilePath: null };

  /**
   * Indicates if data loaded successfully.
   * @type {boolean}
   */
  #DataLoaded = false;

  /**
   * Error message when data fails to load.
   * @type {string|null}
   */
  #DataLoadError = null;

  /**
   * Initialize a new instance.
   */
  constructor() {
    const DirPath = path.resolve(path.join(__dirname, '..', 'data', 'runtime'));
    this.#SettingsFilePath = path.join(DirPath, 'settings.json');
  }

  /**
   * Was settings data loaded successfully?
   * @returns {boolean}
   */
  get DataLoaded() { return this.#DataLoaded; }

  /**
   * If DataLoaded is false this holds a short reason why.
   * @returns {string|null}
   */
  get DataLoadError() { return this.#DataLoadError; }

  /**
   * Start the settings system.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    const DirPath = path.dirname(this.#SettingsFilePath);
    await fs.mkdir(DirPath, { recursive: true });
    try {
      const FileData = await fs.readFile(this.#SettingsFilePath, 'utf8');
      const Parsed = JSON.parse(FileData);
      if(typeof Parsed === 'object' && Parsed) {
        this.Settings = { ...this.Settings, ...Parsed };
        this.#DataLoaded = true;
        this.#DataLoadError = null;
      } else {
        this.#DataLoaded = false;
        this.#DataLoadError = 'empty or invalid data';
      }
    } catch(error) {
      if(error.code === 'ENOENT') {
        this.#DataLoadError = 'file not found';
      } else {
        this.#DataLoadError = error.message;
      }
      this.#DataLoaded = false;
    }
  }

  /**
   * Save current settings to disk.
   * @returns {Promise<void>}
   */
  async SaveAsync() {
    const Data = JSON.stringify(this.Settings, null, 2);
    await fs.writeFile(this.#SettingsFilePath, Data, 'utf8');
  }

  /**
   * Set the last manual file path and save.
   * @param {string} ArgFilePath File path to save.
   * @returns {Promise<void>}
   */
  async SetLastManualFilePathAsync(ArgFilePath) {
    this.Settings.LastManualFilePath = ArgFilePath;
    await this.SaveAsync();
  }

  /**
   * Get the last manual file path.
   * @returns {string|null}
   */
  GetLastManualFilePath() { return this.Settings.LastManualFilePath; }
}

module.exports = SettingsModule;

