// combined logger that writes to both console and file (on Mac).
const { ConsoleLogger } = require('@slack/logger');
const FileLogger = require('./file-logger');
const path = require('path');

/**
 * CombinedLogger class that wraps Slack's ConsoleLogger and adds file logging on Mac.
 * Implements the same interface as Slack's Logger.
 */
class CombinedLogger {
  /**
   * Initialize the combined logger.
   * @param {string} [ArgName] Optional logger name.
   * @param {string} [ArgLogDirectory] Directory for log files (defaults to data/logs).
   */
  constructor(ArgName, ArgLogDirectory) {
    // create the console logger (always active).
    this.#ConsoleLogger = new ConsoleLogger();
    if(ArgName) this.#ConsoleLogger.setName(ArgName);
    
    // create the file logger (only active on Mac).
    const logDir = ArgLogDirectory || path.join(__dirname, '..', 'data', 'logs');
    this.#FileLogger = new FileLogger(logDir);
    
    // log initialization status.
    if(this.#FileLogger.IsEnabled) {
      this.info(`file logging enabled (${process.platform}), logs in: ${logDir}`);
    }
  }

  /**
   * Console logger instance.
   * @type {ConsoleLogger}
   */
  #ConsoleLogger;

  /**
   * File logger instance.
   * @type {FileLogger}
   */
  #FileLogger;

  /**
   * Set the logger name.
   * @param {string} ArgName Logger name.
   */
  setName(ArgName) {
    this.#ConsoleLogger.setName(ArgName);
  }

  /**
   * Set the log level.
   * @param {any} ArgLevel Log level.
   */
  setLevel(ArgLevel) {
    this.#ConsoleLogger.setLevel(ArgLevel);
  }

  /**
   * Get the current log level.
   * @returns {any}
   */
  getLevel() {
    return this.#ConsoleLogger.getLevel();
  }

  /**
   * Log a debug message.
   * @param {...any} ArgMessages Messages to log.
   */
  debug(...ArgMessages) {
    this.#ConsoleLogger.debug(...ArgMessages);
    this.#FileLogger.WriteAsync('debug', this.#FormatMessages(ArgMessages));
  }

  /**
   * Log an info message.
   * @param {...any} ArgMessages Messages to log.
   */
  info(...ArgMessages) {
    this.#ConsoleLogger.info(...ArgMessages);
    this.#FileLogger.WriteAsync('info', this.#FormatMessages(ArgMessages));
  }

  /**
   * Log a warning message.
   * @param {...any} ArgMessages Messages to log.
   */
  warn(...ArgMessages) {
    this.#ConsoleLogger.warn(...ArgMessages);
    this.#FileLogger.WriteAsync('warn', this.#FormatMessages(ArgMessages));
  }

  /**
   * Log an error message.
   * @param {...any} ArgMessages Messages to log.
   */
  error(...ArgMessages) {
    this.#ConsoleLogger.error(...ArgMessages);
    this.#FileLogger.WriteAsync('error', this.#FormatMessages(ArgMessages));
  }

  /**
   * Format multiple message arguments into a single string.
   * @param {any[]} ArgMessages Array of messages.
   * @returns {string}
   */
  #FormatMessages(ArgMessages) {
    return ArgMessages.map(msg => {
      if(typeof msg === 'object' && msg !== null) {
        // handle Error objects specially.
        if(msg instanceof Error) {
          return msg.stack || msg.message;
        }
        // handle other objects.
        try {
          return JSON.stringify(msg, null, 2);
        } catch {
          return String(msg);
        }
      }
      return String(msg);
    }).join(' ');
  }

  /**
   * Write a separator to the file log (custom method for our use).
   * @param {string} [ArgLabel] Optional label for the separator.
   * @returns {Promise<void>}
   */
  async WriteSeparatorAsync(ArgLabel) {
    await this.#FileLogger.WriteSeparatorAsync(ArgLabel);
  }
}

// export the class.
module.exports = CombinedLogger;