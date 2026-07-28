
// import necessary modules.
const path = require('path');
const fs = require('fs').promises;

// define the suffix used for workspace file names. This helps us identify workspace files in the workspaces
// directory, making it easier to ignore other files that may be present.
const WORKSPACE_FILE_SUFFIX = '_workspace.json';

// define a regular expression to validate workspace names (which can only have
// alphanumeric characters, underscores, and hyphens, to ensure they are safe for
// file names).
const VALID_WORKSPACE_NAME_REGEX = /^[a-zA-Z0-9_\-]+$/;

/**
 * @typedef {Object} WorkspaceInfo
 * @property {string} WORKSPACE_NAME         Name of the Slack workspace.
 * @property {string} ADMIN_EMAIL            Contact details of the Slack workspace admin.
 * @property {string} LIVE_TOKEN             Token required to connect to the Slack app.
 * @property {string} LIVE_SIGNING_SECRET    Signing secret required for Slack app verification.
 * @property {string} LIVE_APP_TOKEN         App token required to connect to the Slack app.
 * @property {string} [OPENAI_API_KEY]       Optional API key for accessing OpenAI services.
 * @property {string} [ANTHROPIC_API_KEY]    Optional API key for accessing Anthropic Claude services. Required to switch to claude-* models.
 * @property {string} [GEMINI_API_KEY]       Optional API key for accessing Google Gemini services.
 * @property {string} REMINDER_CHANNEL_NAME  Name of the Slack channel for reminders.
 * @property {string} MAIN_TIMEZONE          Main timezone for the workspace.
 * @property {string[]} [SNOOZE_DAYS]        Days of the week when reminders are disabled.
 * @property {string} [STARTUP_MESSAGE]      Set to 'true' or 'yes' to post a compact "Sleuth has been updated to X from the Y branch" notice on startup and "Sleuth is shutting down." on shutdown. Off by default.
 * @property {string} [STARTUP_MESSAGE_INCLUDE_CHANGELOG] Set to 'true' or 'yes' to opt into the verbose startup body: a short changelog excerpt appended to the compact deploy notice, AND the delayed GitHub Actions CI run summary follow-up (when GITHUB_ACTIONS_REPO is also configured). Subordinate to STARTUP_MESSAGE — has no effect if STARTUP_MESSAGE is not also truthy. Off by default. Despite the name, this flag now gates both verbose extras; the name is preserved for compatibility with workspaces that may already set it.
 * @property {string} [NOTION_TOKEN]         Token for accessing the Notion API.
 * @property {string} [GITHUB_PAT]           GitHub personal access token for issue status sync.
 * @property {string} [GITHUB_USER_MAP]       Optional JSON object mapping Slack user IDs to GitHub usernames, e.g. `{"U000EXAMPLE1": "octo-dev"}`. Used by the show-me command for GitHub activity enrichment.
 * @property {string} [GITHUB_ACTIONS_REPO]  Optional owner/repo used to append the latest Actions run summary to startup messages.
 * @property {string} [GITHUB_ACTIONS_WORKFLOW] Optional workflow filename or ID used to scope the startup Actions summary.
 * @property {string} [GITHUB_ACTIONS_BRANCH] Optional branch override for the startup Actions summary. Defaults to Sleuth's current git branch.
 * @property {string} [GITHUB_SYNC_HEARTBEAT_ENABLED] Set to 'true' or 'yes' to post GitHub sync heartbeat messages in the reminder channel after each poll cycle.
 * @property {string} [DAILY_TASK_DIGEST_TIME] Optional HH:MM time in workspace timezone for daily task digest.
 * @property {string} [WPDBTK_RAG_ENABLED] Set to 'true' or 'yes' to enable the admin-only `ask-woo` command for this workspace.
 * @property {string} [WPDBTK_RAG_BASE_URL] Base URL for the WP DB Toolkit RAG service.
 * @property {string} [WPDBTK_RAG_SERVICE_TOKEN] Bearer token used to authenticate Sleuth to the WP DB Toolkit RAG service.
 * @property {string} [WPDBTK_RAG_DEFAULT_SOURCE] Default source identifier to send with `ask-woo` requests.
 * @property {string} [DEFAULT_MODEL_NAME]    Optional persisted general-purpose chat model. Set by `switch-models:default='...'`. If absent, WorkspaceAI uses 'gpt-4o-mini'.
 * @property {string} [COMPLEX_MODEL_NAME]    Optional persisted complex/date-extraction model. Set by `switch-models:complex='...'`. If absent, WorkspaceAI uses 'gpt-4o'.
 */

/**
 * Provides functions for managing workspaces in the Sleuth app.
 */
class Workspaces {
  /**
   * Get the path to the directory where workspace files are stored.
   * @returns {string}
   */
  static GetDirPath() {
    return path.resolve(path.join(__dirname, '..', 'data', 'runtime', 'workspaces'));
  }

  /**
   * Create a workspace file name from the given workspace name.
   * @param {string} ArgWorkspaceName Name of the workspace.
   * @returns {string}
   */
  static MakeWorkspaceFileName(ArgWorkspaceName) {
    return `${ArgWorkspaceName}${WORKSPACE_FILE_SUFFIX}`;
  }

  /**
   * Create a file path rooted in the workspaces directory from the given workspace name.
   * @param {string} ArgWorkspaceName Name of the workspace.
   * @returns {string}
   */
  static MakeWorkspaceFilePath(ArgWorkspaceName) {
    return path.join(this.GetDirPath(), this.MakeWorkspaceFileName(ArgWorkspaceName));
  }

  /**
   * Get the workspace name from the given file path.
   * 
   * This function should only be used with file paths matching the naming convention
   * followed by the MakeWorkspaceFilePath() function.
   * @param {string} ArgFilePath Path to the workspace file.
   * @returns {string}
   */
  static GetWorkspaceNameFromFilePath(ArgFilePath) {
    // extract the file name from the path and return everything before the workspace file suffix.
    const FileName = path.basename(ArgFilePath);
    return FileName.substring(0, FileName.length - WORKSPACE_FILE_SUFFIX.length);
  }

  /**
   * Enumerate the full paths of all workspace files in the workspaces directory.
   * @returns {Promise<string[]>}
   */
  static async EnumerateWorkspaceFilePathsAsync() {
    // get a list of all file names in the workspaces directory.
    const DirPath = this.GetDirPath();
    const FileNames = await fs.readdir(DirPath);

    // filter the list to only include files that end with the workspace file suffix
    // then return the full path to each workspace file.
    return FileNames.filter(
      ArgFileName => ArgFileName.endsWith(WORKSPACE_FILE_SUFFIX)
    ).map(
      ArgFileName => path.join(DirPath, ArgFileName)
    );
  }

  /**
   * Enumerate the workspace names from all the files in the workspaces directory.
   * @returns {Promise<string[]>}
   */
  static async EnumerateWorkspaceNamesAsync() {
    // get the full paths of all workspace files, then extract and return the workspace name from each path.
    const WorkspaceFilePaths = await this.EnumerateWorkspaceFilePathsAsync();
    return WorkspaceFilePaths.map(this.GetWorkspaceNameFromFilePath);
  }

  /**
   * Normalize workspace fields that are commonly submitted by HTML forms.
   * Blank optional AI-key fields are removed so callers can submit one selected
   * provider without needing brittle conditional payload assembly.
   * @param {WorkspaceInfo} ArgTargetWorkspace Workspace info object to normalize.
   * @returns {WorkspaceInfo}
   */
  static NormalizeWorkspaceInfo(ArgTargetWorkspace) {
    const NormalizedWorkspace = { ...ArgTargetWorkspace };
    const OptionalAiKeyFieldNames = /** @type {const} */ ([
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
    ]);
    for(const FieldName of OptionalAiKeyFieldNames) {
      if(!NormalizedWorkspace.hasOwnProperty(FieldName)) continue;
      if(typeof NormalizedWorkspace[FieldName] !== 'string') continue;

      const TrimmedValue = NormalizedWorkspace[FieldName].trim();
      if(TrimmedValue.length === 0) {
        delete NormalizedWorkspace[FieldName];
        continue;
      }

      NormalizedWorkspace[FieldName] = TrimmedValue;
    }

    return NormalizedWorkspace;
  }

  /**
   * Validate the WorkspaceInfo object to ensure all required fields are present and valid.
   * @param {WorkspaceInfo} ArgTargetWorkspace Workspace info object to validate.
   */
  static ValidateWorkspaceInfo(ArgTargetWorkspace) {
    // define the required fields in an array for easy checking.
    const RequiredFields = [
      'WORKSPACE_NAME',
      'ADMIN_EMAIL',
      'LIVE_TOKEN',
      'LIVE_SIGNING_SECRET',
      'LIVE_APP_TOKEN',
      'REMINDER_CHANNEL_NAME',
      'MAIN_TIMEZONE'
    ];

    // determine which fields are missing (i.e: not present in the object we parsed earlier).
    const MissingFields = RequiredFields.filter(ArgField => !ArgTargetWorkspace.hasOwnProperty(ArgField));

    // report an error if any required fields are missing. This is important since workspace JSON may be
    // edited by hand, and validation prevents strange errors occurring due to missing fields.
    if(MissingFields.length > 0)
      throw new Error(`Missing required fields: ${MissingFields.join(', ')}`);

    // validate the workspace name.
    if(!VALID_WORKSPACE_NAME_REGEX.test(ArgTargetWorkspace.WORKSPACE_NAME))
      throw new Error(`Invalid workspace name: ${ArgTargetWorkspace.WORKSPACE_NAME}`);

    // require at least one supported AI provider key for the workspace.
    const SupportedAiKeyFieldNames = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'];
    const ConfiguredAiKeyFieldNames = SupportedAiKeyFieldNames.filter(
      ArgFieldName => ArgTargetWorkspace.hasOwnProperty(ArgFieldName)
    );
    if(ConfiguredAiKeyFieldNames.length === 0) {
      throw new Error(
        'At least one AI API key is required: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY'
      );
    }

    // validate optional OpenAI API key if provided.
    if(ArgTargetWorkspace.hasOwnProperty('OPENAI_API_KEY')) {
      if(typeof ArgTargetWorkspace.OPENAI_API_KEY !== 'string')
        throw new Error('OPENAI_API_KEY must be a string');

      if(ArgTargetWorkspace.OPENAI_API_KEY.trim().length === 0)
        throw new Error('OPENAI_API_KEY cannot be empty');
    }

    // validate snooze days if provided.
    if(ArgTargetWorkspace.hasOwnProperty('SNOOZE_DAYS')) {
      if(!Array.isArray(ArgTargetWorkspace.SNOOZE_DAYS))
        throw new Error('SNOOZE_DAYS must be an array of day names');

      const ValidDays = new Set([
        'sunday', 'monday', 'tuesday', 'wednesday',
        'thursday', 'friday', 'saturday'
      ]);

      for(const Day of ArgTargetWorkspace.SNOOZE_DAYS) {
        if(typeof Day !== 'string' || !ValidDays.has(Day.toLowerCase()))
          throw new Error(`Invalid day in SNOOZE_DAYS: ${Day}`);
      }
    }

    // validate daily digest time if provided.
    if(ArgTargetWorkspace.DAILY_TASK_DIGEST_TIME) {
      const TimeMatch = ArgTargetWorkspace.DAILY_TASK_DIGEST_TIME.match(/^(\d{1,2}):(\d{2})$/);
      if(!TimeMatch)
        throw new Error('DAILY_TASK_DIGEST_TIME must be in HH:MM format');

      const HourValue = parseInt(TimeMatch[1], 10);
      const MinuteValue = parseInt(TimeMatch[2], 10);
      if(HourValue < 0 || HourValue > 23 || MinuteValue < 0 || MinuteValue > 59)
        throw new Error('DAILY_TASK_DIGEST_TIME must specify a valid hour and minute');
    }

    // validate optional Anthropic API key if provided.
    if(ArgTargetWorkspace.hasOwnProperty('ANTHROPIC_API_KEY')) {
      if(typeof ArgTargetWorkspace.ANTHROPIC_API_KEY !== 'string')
        throw new Error('ANTHROPIC_API_KEY must be a string');

      if(ArgTargetWorkspace.ANTHROPIC_API_KEY.trim().length === 0)
        throw new Error('ANTHROPIC_API_KEY cannot be empty');
    }

    // validate optional Gemini API key if provided.
    if(ArgTargetWorkspace.hasOwnProperty('GEMINI_API_KEY')) {
      if(typeof ArgTargetWorkspace.GEMINI_API_KEY !== 'string')
        throw new Error('GEMINI_API_KEY must be a string');

      if(ArgTargetWorkspace.GEMINI_API_KEY.trim().length === 0)
        throw new Error('GEMINI_API_KEY cannot be empty');
    }

    // validate GitHub PAT if provided.
    if(ArgTargetWorkspace.hasOwnProperty('GITHUB_PAT')) {
      if(typeof ArgTargetWorkspace.GITHUB_PAT !== 'string')
        throw new Error('GITHUB_PAT must be a string');

      if(ArgTargetWorkspace.GITHUB_PAT.trim().length === 0)
        throw new Error('GITHUB_PAT cannot be empty');
    }

    const OptionalGitHubActionsFieldNames = /** @type {const} */ ([
      'GITHUB_ACTIONS_REPO',
      'GITHUB_ACTIONS_WORKFLOW',
      'GITHUB_ACTIONS_BRANCH',
    ]);
    for(const GitHubActionsFieldName of OptionalGitHubActionsFieldNames) {
      if(!ArgTargetWorkspace.hasOwnProperty(GitHubActionsFieldName)) continue;

      const GitHubActionsFieldValue = ArgTargetWorkspace[GitHubActionsFieldName];
      if(typeof GitHubActionsFieldValue !== 'string')
        throw new Error(`${GitHubActionsFieldName} must be a string`);

      if(GitHubActionsFieldValue.trim().length === 0)
        throw new Error(`${GitHubActionsFieldName} cannot be empty`);
    }

    // validate GITHUB_USER_MAP if provided.
    if(ArgTargetWorkspace.hasOwnProperty('GITHUB_USER_MAP')) {
      if(typeof ArgTargetWorkspace.GITHUB_USER_MAP !== 'string')
        throw new Error('GITHUB_USER_MAP must be a string');

      if(ArgTargetWorkspace.GITHUB_USER_MAP.trim().length === 0)
        throw new Error('GITHUB_USER_MAP cannot be empty');

      let ParsedMap;
      try {
        ParsedMap = JSON.parse(ArgTargetWorkspace.GITHUB_USER_MAP);
      } catch(error) {
        throw new Error('GITHUB_USER_MAP must be valid JSON');
      }

      if(typeof ParsedMap !== 'object' || ParsedMap === null || Array.isArray(ParsedMap))
        throw new Error('GITHUB_USER_MAP must be a JSON object');

      for(const [MapKey, MapValue] of Object.entries(ParsedMap)) {
        if(typeof MapValue !== 'string' || MapValue.trim().length === 0)
          throw new Error(`GITHUB_USER_MAP entry for key "${MapKey}" must be a non-empty string`);
      }
    }

    // validate GitHub sync heartbeat flag if provided.
    if(ArgTargetWorkspace.hasOwnProperty('GITHUB_SYNC_HEARTBEAT_ENABLED')) {
      if(typeof ArgTargetWorkspace.GITHUB_SYNC_HEARTBEAT_ENABLED !== 'string')
        throw new Error('GITHUB_SYNC_HEARTBEAT_ENABLED must be a string');

      const RawHeartbeatFlag = ArgTargetWorkspace.GITHUB_SYNC_HEARTBEAT_ENABLED.trim().toLowerCase();
      const ValidHeartbeatFlags = new Set(['true', 'yes', 'false', 'no']);
      if(!ValidHeartbeatFlags.has(RawHeartbeatFlag))
        throw new Error('GITHUB_SYNC_HEARTBEAT_ENABLED must be one of: true, yes, false, no');
    }

    // validate persisted model names if provided.
    const PersistedModelFieldNames = /** @type {const} */ (['DEFAULT_MODEL_NAME', 'COMPLEX_MODEL_NAME']);
    for(const ModelFieldName of PersistedModelFieldNames) {
      if(!ArgTargetWorkspace.hasOwnProperty(ModelFieldName)) continue;

      const ModelFieldValue = ArgTargetWorkspace[ModelFieldName];
      if(typeof ModelFieldValue !== 'string')
        throw new Error(`${ModelFieldName} must be a string`);

      if(ModelFieldValue.trim().length === 0)
        throw new Error(`${ModelFieldName} cannot be empty`);
    }

    // validate WPDBTK RAG enablement if provided.
    let WpdbtkRagEnabled = false;
    if(ArgTargetWorkspace.hasOwnProperty('WPDBTK_RAG_ENABLED')) {
      if(typeof ArgTargetWorkspace.WPDBTK_RAG_ENABLED !== 'string')
        throw new Error('WPDBTK_RAG_ENABLED must be a string');

      const RawWpdbtkFlag = ArgTargetWorkspace.WPDBTK_RAG_ENABLED.trim().toLowerCase();
      const ValidWpdbtkFlags = new Set(['true', 'yes', 'false', 'no']);
      if(!ValidWpdbtkFlags.has(RawWpdbtkFlag))
        throw new Error('WPDBTK_RAG_ENABLED must be one of: true, yes, false, no');

      WpdbtkRagEnabled = RawWpdbtkFlag === 'true' || RawWpdbtkFlag === 'yes';
    }

    // validate WPDBTK RAG config fields if provided.
    if(ArgTargetWorkspace.hasOwnProperty('WPDBTK_RAG_BASE_URL')) {
      if(typeof ArgTargetWorkspace.WPDBTK_RAG_BASE_URL !== 'string')
        throw new Error('WPDBTK_RAG_BASE_URL must be a string');

      const RawBaseUrl = ArgTargetWorkspace.WPDBTK_RAG_BASE_URL.trim();
      if(RawBaseUrl.length === 0)
        throw new Error('WPDBTK_RAG_BASE_URL cannot be empty');

      let ParsedBaseUrl;
      try {
        ParsedBaseUrl = new URL(RawBaseUrl);
      } catch(error) {
        throw new Error('WPDBTK_RAG_BASE_URL must be a valid URL');
      }

      if(ParsedBaseUrl.protocol !== 'http:' && ParsedBaseUrl.protocol !== 'https:')
        throw new Error('WPDBTK_RAG_BASE_URL must use http or https');
    }

    if(ArgTargetWorkspace.hasOwnProperty('WPDBTK_RAG_SERVICE_TOKEN')) {
      if(typeof ArgTargetWorkspace.WPDBTK_RAG_SERVICE_TOKEN !== 'string')
        throw new Error('WPDBTK_RAG_SERVICE_TOKEN must be a string');

      if(ArgTargetWorkspace.WPDBTK_RAG_SERVICE_TOKEN.trim().length === 0)
        throw new Error('WPDBTK_RAG_SERVICE_TOKEN cannot be empty');
    }

    if(ArgTargetWorkspace.hasOwnProperty('WPDBTK_RAG_DEFAULT_SOURCE')) {
      if(typeof ArgTargetWorkspace.WPDBTK_RAG_DEFAULT_SOURCE !== 'string')
        throw new Error('WPDBTK_RAG_DEFAULT_SOURCE must be a string');

      if(ArgTargetWorkspace.WPDBTK_RAG_DEFAULT_SOURCE.trim().length === 0)
        throw new Error('WPDBTK_RAG_DEFAULT_SOURCE cannot be empty');
    }

    if(WpdbtkRagEnabled) {
      const RequiredWpdbtkFields = [
        'WPDBTK_RAG_BASE_URL',
        'WPDBTK_RAG_SERVICE_TOKEN',
        'WPDBTK_RAG_DEFAULT_SOURCE'
      ];
      const MissingWpdbtkFields = RequiredWpdbtkFields.filter(
        ArgField => !ArgTargetWorkspace.hasOwnProperty(ArgField)
      );

      if(MissingWpdbtkFields.length > 0)
        throw new Error(`WPDBTK_RAG_ENABLED requires fields: ${MissingWpdbtkFields.join(', ')}`);
    }
  }

  /**
   * Check if a workspace file exists and is accessible by the current process.
   * @param {string} ArgWorkspaceName Name of the workspace.
   * @returns {Promise<boolean>}
   */
  static async WorkspaceExistsAsync(ArgWorkspaceName) {
    try {
      // compute the file path for the workspace file.
      const FilePath = this.MakeWorkspaceFilePath(ArgWorkspaceName);

      // check if the file exists and can be read and written by the current process.
      await fs.access(FilePath, fs.constants.R_OK | fs.constants.W_OK);

      // if no errors occurred, the file exists and is accessible so return true.
      return true;
    } catch {
      // if an error occurred, the file doesn't exist or is inaccessible, so return false.
      return false;
    }
  }

  /**
   * Load a WorkspaceInfo object from the JSON file at the given path.
   * 
   * An error is thrown if required fields are missing or if the file cannot be read/parsed.
   * @param {string} ArgFilePath Path to the JSON file.
   * @returns {Promise<WorkspaceInfo>}
   */
  static async LoadWorkspaceInfoAsync(ArgFilePath) {
    try {
      // load the file contents and parse it as JSON.
      const FileContents = await fs.readFile(ArgFilePath, 'utf8');
      const TargetWorkspace = this.NormalizeWorkspaceInfo(JSON.parse(FileContents));

      // validate the workspace info.
      this.ValidateWorkspaceInfo(TargetWorkspace);

      // the object is valid, so return it.
      return TargetWorkspace;
    } catch(error) {
      // if we couldn't read the file, parse it, or if it's missing required fields, throw an error.
      throw new Error(`Failed to load workspace info: ${error.message}`);
    }
  }

  /**
   * Load a WorkspaceInfo object using the given workspace name.
   * @param {string} ArgWorkspaceName Name of the workspace.
   * @returns {Promise<WorkspaceInfo>}
   */
  static LoadWorkspaceInfoByNameAsync(ArgWorkspaceName) {
    // derive the file path from the workspace name, load the workspace info, and return it
    // NOTE: this function isn't marked as async since it doesn't need to await anything but
    // just returns the promise returned by LoadWorkspaceInfoAsync().
    const FilePath = this.MakeWorkspaceFilePath(ArgWorkspaceName);
    return this.LoadWorkspaceInfoAsync(FilePath);
  }

  /**
   * Save a WorkspaceInfo object to a JSON file in the workspaces directory.
   * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info object to save.
   * @returns {Promise<void>}
   */
  static async SaveWorkspaceInfoAsync(ArgWorkspaceInfo) {
    const NormalizedWorkspaceInfo = this.NormalizeWorkspaceInfo(ArgWorkspaceInfo);

    // validate the workspace info.
    this.ValidateWorkspaceInfo(NormalizedWorkspaceInfo);

    // derive the file path from the workspace name.
    const FilePath = this.MakeWorkspaceFilePath(NormalizedWorkspaceInfo.WORKSPACE_NAME);

    // convert the workspace info object to a JSON string.
    const FileContents = JSON.stringify(NormalizedWorkspaceInfo, null, 2);

    // write the JSON string to the file.
    await fs.writeFile(FilePath, FileContents, 'utf8');
  }

  /**
   * Delete the workspace file for the given workspace name.
   * @param {string} ArgWorkspaceName Name of the workspace to delete.
   * @returns {Promise<void>}
   */
  static async DeleteWorkspaceAsync(ArgWorkspaceName) {
    try {
      // compute the file path for the workspace file and delete it.
      const FilePath = this.MakeWorkspaceFilePath(ArgWorkspaceName);
      await fs.unlink(FilePath);
    } catch(error) {
      // if an error occurred, report it. NOTE: for now, we still report the error
      // even if the file doesn't exist, since this may indicate broken expectations
      // on the part of the caller.
      throw new Error(`Failed to delete workspace: ${error.message}`);
    }
  }
}

// export the class.
module.exports = Workspaces;
