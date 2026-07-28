// file-based logger for development on Mac.
const fs = require('fs').promises;
const path = require('path');

/**
 * FileLogger class that writes logs to date-based files for development.
 * Only activates on Mac (Darwin) systems, not on Linux production servers.
 */
class FileLogger {
  /**
   * Initialize the file logger.
   * @param {string} ArgLogDirectory Directory where log files will be stored.
   * @param {boolean} [ArgForceEnable] Force enable logging regardless of platform (for testing).
   */
  constructor(ArgLogDirectory, ArgForceEnable = false) {
    // only enable file logging on Mac (Darwin) systems, not Linux.
    this.#Enabled = ArgForceEnable || process.platform === 'darwin';
    this.#LogDirectory = ArgLogDirectory;
    this.#CurrentLogFile = null;
    this.#CurrentDate = null;
    
    if(this.#Enabled) {
      // create log directory if it doesn't exist.
      this.#EnsureLogDirectoryAsync();
    }
  }

  /**
   * Whether file logging is enabled.
   * @type {boolean}
   */
  #Enabled;

  /**
   * Directory where log files are stored.
   * @type {string}
   */
  #LogDirectory;

  /**
   * Current log file path.
   * @type {string|null}
   */
  #CurrentLogFile;

  /**
   * Current date string for log rotation.
   * @type {string|null}
   */
  #CurrentDate;

  /**
   * Ensure the log directory exists.
   * @returns {Promise<void>}
   */
  async #EnsureLogDirectoryAsync() {
    try {
      await fs.mkdir(this.#LogDirectory, { recursive: true });
    } catch(error) {
      console.error('failed to create log directory:', error);
      this.#Enabled = false; // disable logging if we can't create the directory.
    }
  }

  /**
   * Get formatted timestamp in PT timezone.
   * @returns {string}
   */
  #GetTimestamp() {
    // create date in PT timezone.
    const now = new Date();
    const ptOptions = /** @type {Intl.DateTimeFormatOptions} */ ({
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    // format: "Aug 04, 2025, 08:54:18"
    const ptString = now.toLocaleString('en-US', ptOptions);
    
    // reformat to match desired format: "[04-Aug-2025 08:54:18 PT]"
    const parts = ptString.split(', ');
    const dateParts = parts[0].split(' ');
    const month = dateParts[0];
    const day = dateParts[1];
    const year = parts[1];
    const time = parts[2];
    
    return `[${day}-${month}-${year} ${time} PT]`;
  }

  /**
   * Get the log file path for today.
   * @returns {string}
   */
  #GetLogFilePath() {
    // get current date in PT timezone for file naming.
    const now = new Date();
    const ptDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    // format: "2025-08-04"
    const year = ptDate.getFullYear();
    const month = String(ptDate.getMonth() + 1).padStart(2, '0');
    const day = String(ptDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    // check if we need to rotate to a new file.
    if(this.#CurrentDate !== dateString) {
      this.#CurrentDate = dateString;
      this.#CurrentLogFile = path.join(this.#LogDirectory, `sleuth-${dateString}.log`);
    }
    
    return this.#CurrentLogFile;
  }

  /**
   * Write a log entry to the file.
   * @param {string} ArgLevel Log level (info, error, warn, debug).
   * @param {string} ArgMessage Log message.
   * @param {any} [ArgData] Optional data to log.
   * @returns {Promise<void>}
   */
  async WriteAsync(ArgLevel, ArgMessage, ArgData) {
    if(!this.#Enabled) return;
    
    // filter out noisy debug messages for cleaner logs.
    const noisyPatterns = [
      'apiCall(',
      'http request',
      'http response',
      'WebSocket',
      'send() method',
      'isActive():',
      'Received a message on the WebSocket',
      'Sending a WebSocket message',
      '[[REDACTED]]',
      'DEBUG'
    ];
    
    // skip debug messages that match noisy patterns.
    if(ArgLevel.toLowerCase() === 'debug') {
      for(const pattern of noisyPatterns) {
        if(ArgMessage.includes(pattern)) return;
      }
    }
    
    try {
      const timestamp = this.#GetTimestamp();
      const logFile = this.#GetLogFilePath();
      
      // format the log entry.
      let logEntry = `${timestamp} [${ArgLevel.toUpperCase()}] ${ArgMessage}`;
      
      // add data if provided.
      if(ArgData !== undefined) {
        if(typeof ArgData === 'object') {
          // pretty print objects with 2-space indentation.
          const formatted = JSON.stringify(ArgData, null, 2);
          // indent each line for better readability.
          const indented = formatted.split('\n').map(line => '    ' + line).join('\n');
          logEntry += '\n' + indented;
        } else {
          logEntry += ' ' + String(ArgData);
        }
      }
      
      // add newline at the end.
      logEntry += '\n';
      
      // append to log file.
      await fs.appendFile(logFile, logEntry, 'utf8');
    } catch(error) {
      // silently fail to avoid disrupting the app.
      console.error('file logger write failed:', error);
    }
  }

  /**
   * Log a separator line for new messages.
   * @param {string} [ArgLabel] Optional label for the separator.
   * @returns {Promise<void>}
   */
  async WriteSeparatorAsync(ArgLabel) {
    if(!this.#Enabled) return;
    
    const timestamp = this.#GetTimestamp();
    const separator = '='.repeat(90);
    let logEntry = `${timestamp} ${separator}`;
    if(ArgLabel) logEntry += ` ${ArgLabel}`;
    logEntry += '\n';
    
    try {
      const logFile = this.#GetLogFilePath();
      await fs.appendFile(logFile, logEntry, 'utf8');
    } catch(error) {
      // silently fail.
      console.error('file logger separator write failed:', error);
    }
  }

  /**
   * Check if file logging is enabled.
   * @returns {boolean}
   */
  get IsEnabled() {
    return this.#Enabled;
  }
}

// export the class.
module.exports = FileLogger;