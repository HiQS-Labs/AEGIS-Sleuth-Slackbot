
// import required modules.
const fs = require('fs').promises;
const path = require('path');

/**
 * Registry entry for a single plugin.
 * @typedef {Object} PluginRegistryEntry
 * @property {string} name Unique kebab-case identifier.
 * @property {string} displayName Human-readable name.
 * @property {string} version Semver version string.
 * @property {string} purpose One-sentence description.
 * @property {string} publisher Organization or individual who owns the plugin.
 * @property {number} phase Minimum plugin phase required.
 * @property {string} entryPoint Path to plugin main file, relative to project root.
 * @property {boolean} enabled Whether the plugin should be loaded.
 */

/**
 * Root structure of the plugin registry JSON file.
 * @typedef {Object} PluginRegistry
 * @property {string} version Registry schema version.
 * @property {PluginRegistryEntry[]} plugins Array of registered plugins.
 */

/**
 * Runtime plugin instance shape.
 * @typedef {Object} PluginInstance
 * @property {(ArgSlackApp: import('./slack-app'), ArgWorkspaceInfo: import('./workspaces').WorkspaceInfo) => Promise<void>} StartAsync Start hook.
 * @property {(() => Promise<void>)|undefined} [StopAsync] Optional stop hook.
 */

/**
 * Loads, starts, and stops plugins defined in data/plugin-registry.json.
 * One PluginLoader instance is created per workspace.
 */
class PluginLoader {
  /**
   * Slack app instance for the workspace.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Workspace configuration.
   * @type {import('./workspaces').WorkspaceInfo}
   */
  #WorkspaceInfo;

  /**
   * Active plugin instances for this workspace.
   * @type {{ entry: PluginRegistryEntry, instance: PluginInstance }[]}
   */
  #ActivePlugins = [];

  /**
   * Path to the plugin registry JSON file.
   * @type {string}
   */
  #RegistryPath = path.resolve(path.join(__dirname, '..', 'data', 'plugin-registry.json'));

  /**
   * Absolute path to the project root; entry points must resolve within this boundary.
   * @type {string}
   */
  #ProjectRoot = path.resolve(path.join(__dirname, '..'));

  /**
   * Initialize a PluginLoader for a single workspace.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   * @param {import('./workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace configuration.
   */
  constructor(ArgSlackApp, ArgWorkspaceInfo) {
    this.#SlackApp = ArgSlackApp;
    this.#WorkspaceInfo = ArgWorkspaceInfo;
  }

  /**
   * Load and start all enabled plugins from the registry.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    let registry;

    // load the plugin registry file.
    try {
      const raw = await fs.readFile(this.#RegistryPath, 'utf-8');
      registry = /** @type {PluginRegistry} */ (JSON.parse(raw));
    } catch(error) {
      if(error.code === 'ENOENT') {
        this.#SlackApp.Logger.info('no plugin registry found; skipping plugin load.');
        return;
      }
      this.#SlackApp.Logger.error('failed to read plugin registry:', error);
      return;
    }

    // validate top-level registry shape.
    if(!registry || !Array.isArray(registry.plugins)) {
      this.#SlackApp.Logger.error('plugin registry is malformed; expected { version, plugins[] }.');
      return;
    }

    // iterate and start enabled plugins.
    for(const entry of registry.plugins) {
      // guard against null, primitives, or arrays in the plugins array.
      if(entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        this.#SlackApp.Logger.error('skipping malformed plugin registry entry (not an object).');
        continue;
      }

      // validate required string fields before touching the filesystem.
      if(typeof entry.name !== 'string' || !entry.name.trim()) {
        this.#SlackApp.Logger.error('skipping plugin registry entry with missing or invalid "name" field.');
        continue;
      }
      if(typeof entry.entryPoint !== 'string' || !entry.entryPoint.trim()) {
        this.#SlackApp.Logger.error(`skipping plugin "${entry.name}": missing or invalid "entryPoint" field.`);
        continue;
      }

      if(!entry.enabled) {
        this.#SlackApp.Logger.info(`plugin "${entry.name}" is disabled; skipping.`);
        continue;
      }

      // resolve the entry point and verify it stays within the project root.
      // this prevents absolute paths or ../.. traversal from loading unintended code.
      let PluginPath;
      try {
        PluginPath = path.resolve(path.join(this.#ProjectRoot, entry.entryPoint));
      } catch(error) {
        this.#SlackApp.Logger.error(`skipping plugin "${entry.name}": could not resolve entryPoint path:`, error);
        continue;
      }

      const Relative = path.relative(this.#ProjectRoot, PluginPath);
      if(Relative.startsWith('..') || path.isAbsolute(Relative)) {
        this.#SlackApp.Logger.error(`skipping plugin "${entry.name}": entryPoint resolves outside project root.`);
        continue;
      }

      let PluginClass;
      try {
        PluginClass = require(PluginPath);
      } catch(error) {
        this.#SlackApp.Logger.error(`failed to require plugin "${entry.name}" at ${PluginPath}:`, error);
        continue;
      }

      // validate the plugin exports a class with a StartAsync method.
      if(typeof PluginClass !== 'function' || typeof PluginClass.prototype.StartAsync !== 'function') {
        this.#SlackApp.Logger.error(`plugin "${entry.name}" must export a class with a StartAsync method.`);
        continue;
      }

      try {
        const instance = new PluginClass();
        await instance.StartAsync(this.#SlackApp, this.#WorkspaceInfo);
        this.#ActivePlugins.push({ entry, instance });
        this.#SlackApp.Logger.info(`plugin "${entry.name}" v${entry.version} started (${entry.publisher}).`);
      } catch(error) {
        this.#SlackApp.Logger.error(`plugin "${entry.name}" failed to start:`, error);
      }
    }
  }

  /**
   * Stop all active plugins in reverse start order.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    // stop in reverse order to mirror LIFO shutdown semantics.
    for(const { entry, instance } of [...this.#ActivePlugins].reverse()) {
      try {
        if(typeof instance.StopAsync === 'function') {
          await instance.StopAsync();
        }
        this.#SlackApp.Logger.info(`plugin "${entry.name}" stopped.`);
      } catch(error) {
        this.#SlackApp.Logger.error(`plugin "${entry.name}" failed to stop cleanly:`, error);
      }
    }
    this.#ActivePlugins = [];
  }

  /**
   * Number of plugins currently active for this workspace.
   * @returns {number}
   */
  get ActiveCount() { return this.#ActivePlugins.length; }
}

// export the class.
module.exports = PluginLoader;
