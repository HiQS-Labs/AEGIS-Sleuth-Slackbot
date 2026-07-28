'use strict';

const {
  FindGlobalSingletonViolations,
  FindStrayRouteRegistrations,
  RunWorkspaceIsolationValidation,
} = require('../scripts/validate-workspace-isolation');

describe('validate-workspace-isolation', () => {
  describe('FindGlobalSingletonViolations (Shape 1)', () => {
    test('flags a global singleton read used to resolve a SlackApp', () => {
      const Lines = [
        'function Resolve() {',
        '  const slackApps = global.__sleuthaskreminders__.slackApps;',
        '  return slackApps[0];',
        '}',
      ];
      const Violations = FindGlobalSingletonViolations('fixture.js', Lines);
      expect(Violations).toHaveLength(1);
      expect(Violations[0]).toMatch(/fixture\.js:2:/);
    });

    test('honors an inline ISOLATION-OK pragma', () => {
      const Lines = [
        'const slackApps = global.__sleuthaskreminders__.slackApps; // ISOLATION-OK: reviewed legacy fallback.',
      ];
      expect(FindGlobalSingletonViolations('fixture.js', Lines)).toHaveLength(0);
    });

    test('does not flag initializing the global singleton store', () => {
      const Lines = [
        'global.__sleuthaskreminders__ = global.__sleuthaskreminders__ || {',
        '  slackApps: [],',
        '};',
      ];
      expect(FindGlobalSingletonViolations('fixture.js', Lines)).toHaveLength(0);
    });
  });

  describe('FindStrayRouteRegistrations (Shape 2)', () => {
    test('flags a primary route registered outside RegisterCommandRoutes', () => {
      const Lines = [
        'class SomeModule {',
        '  SomeOtherMethod() {',
        '    Router.Register({',
        "      Pattern: /^foo\\b/,",
        "      Route: 'foo',",
        '      Handle: (ArgEventInfo) => HandleFooAsync(this.#SlackApp, ArgEventInfo),',
        '    });',
        '  }',
        '}',
      ];
      const Violations = FindStrayRouteRegistrations('fixture.js', 'fixture.js', Lines);
      expect(Violations).toHaveLength(1);
      expect(Violations[0]).toMatch(/fixture\.js:3:/);
    });

    test('allows a primary route registered inside RegisterCommandRoutes', () => {
      const Lines = [
        'class SomeModule {',
        '  RegisterCommandRoutes() {',
        '    Router.Register({',
        "      Pattern: /^foo\\b/,",
        "      Route: 'foo',",
        '      Handle: (ArgEventInfo) => HandleFooAsync(this.#SlackApp, ArgEventInfo),',
        '    });',
        '  }',
        '}',
      ];
      expect(FindStrayRouteRegistrations('fixture.js', 'fixture.js', Lines)).toHaveLength(0);
    });

    test('allows alias delegation registered outside RegisterCommandRoutes', () => {
      const Lines = [
        'function RegisterAliases(ArgRouter) {',
        '  ArgRouter.Register({',
        '    Pattern,',
        '    Route: Alias.Route,',
        '    Handle: (ArgEventInfo, ...ArgCaptures) => {',
        '      return BaseRoute.Handle(ArgEventInfo, ...ArgCaptures);',
        '    },',
        '  });',
        '}',
      ];
      expect(FindStrayRouteRegistrations('fixture.js', 'fixture.js', Lines)).toHaveLength(0);
    });

    test('allows a route registered inside a for-loop nested in RegisterCommandRoutes', () => {
      // Regression: a `for(...) {` header satisfies the same identifier-call-brace shape as a
      // method header, so a naive label stack mistakes the loop for its own method named "for" and
      // shadows the real enclosing RegisterCommandRoutes label for anything nested inside it.
      const Lines = [
        'class SomeModule {',
        '  RegisterCommandRoutes() {',
        '    for(const Provider of Providers) {',
        '      Router.Register({',
        '        Route: Provider.Id,',
        '        Handle: (ArgEventInfo) => HandleProviderAsync(this.#SlackApp, ArgEventInfo, Provider),',
        '      });',
        '    }',
        '  }',
        '}',
      ];
      expect(FindStrayRouteRegistrations('fixture.js', 'fixture.js', Lines)).toHaveLength(0);
    });

    test('exempts src/catalog-regex-aliases.js entirely', () => {
      const Lines = [
        'function RegisterCatalogRegexAliases(ArgRouter) {',
        '  ArgRouter.Register({',
        "    Route: 'ask-reminders',",
        '    Handle: (ArgEventInfo, ArgQuery) => HandleAskRemindersCommandAsync(slackApp, ArgEventInfo, ArgQuery),',
        '  });',
        '}',
      ];
      expect(
        FindStrayRouteRegistrations('src/catalog-regex-aliases.js', 'catalog-regex-aliases.js', Lines)
      ).toHaveLength(0);
    });
  });

  describe('RunWorkspaceIsolationValidation (integration)', () => {
    test('the current src tree is clean', () => {
      expect(RunWorkspaceIsolationValidation()).toEqual([]);
    });
  });
});
