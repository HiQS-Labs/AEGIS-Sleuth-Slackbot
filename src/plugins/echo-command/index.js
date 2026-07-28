
// phase 1 sample plugin — demonstrates the minimum plugin interface.

/**
 * Adds the @sleuth echo <text> command.
 * Replies with "Echo: <text>" in the same thread.
 * Serves as the canonical Phase 1 reference implementation.
 */
class EchoCommandPlugin {
  /**
   * Start the plugin and register the app mention handler.
   * @param {import('../../slack-app')} ArgSlackApp Slack app instance.
   * @param {import('../../workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace configuration.
   * @returns {Promise<void>}
   */
  async StartAsync(ArgSlackApp, ArgWorkspaceInfo) {
    ArgSlackApp.HandleAppMention(this.#OnAppMentionAsync.bind(this));
    ArgSlackApp.Logger.info(`EchoCommandPlugin ready in workspace: ${ArgWorkspaceInfo.WORKSPACE_NAME}.`);
  }

  /**
   * Stop the plugin and release any resources.
   * @returns {Promise<void>}
   */
  async StopAsync() { }

  /**
   * Handle an app mention event and respond to the echo command.
   * @param {import('../../slack-app')} ArgSlackApp Slack app instance.
   * @param {import('../../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
   * @returns {Promise<boolean>}
   */
  async #OnAppMentionAsync(ArgSlackApp, ArgEventInfo) {
    // match "@sleuth echo " prefix (with trailing space).
    const CommandPrefix = `${ArgSlackApp.AppMentionString} echo `;
    if(!ArgEventInfo.text.startsWith(CommandPrefix)) return false;

    // extract the text after the command prefix.
    const EchoText = ArgEventInfo.text.slice(CommandPrefix.length).trim();

    // silently ignore empty echo calls.
    if(!EchoText) return false;

    // reply in the same thread.
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Echo: ${EchoText}`
    );

    return true;
  }
}

// export the class.
module.exports = EchoCommandPlugin;
