// New Relic APM configuration.
//
// Monitoring is OPT-IN and stays disabled unless NEW_RELIC_LICENSE_KEY is set in the environment.
// There is deliberately no fallback key: a hardcoded default silently reports your telemetry into
// whoever owns that key's account, and any key committed here would be public.
//
// To enable, set NEW_RELIC_LICENSE_KEY (and optionally NEW_RELIC_APP_NAME) before starting the app.
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'Sleuth'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || '',
  agent_enabled: Boolean(process.env.NEW_RELIC_LICENSE_KEY),
  logging: {
    level: process.env.NEW_RELIC_LOG_LEVEL || 'info'
  },
  distributed_tracing: {
    enabled: true
  }
}
