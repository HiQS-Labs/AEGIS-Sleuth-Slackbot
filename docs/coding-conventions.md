
# Coding Conventions

All identifiers which have only one word should be in all lowercase (e.g. `files` not `Files`).

All identifiers which have multiple sub-words should be in PascalCase:
- E.g. write `MyFilePath` not `myFilePath`.
- E.g. write `#SomePrivateVariable` not `#somePrivateVariable`.

All class names should be in `PascalCase` even if they have only one word (e.g. `Workspaces`).

All async functions should always be named with the `Async` suffix (e.g. `LoadAsync`).

All parameter names should always be named with the `Arg` prefix (e.g. `ArgFilePath`).

The name of the variable used to catch an error should be lowercase and read `error` (e.g. `catch (error)`).

All single-line comments should follow theses rules:
- They should start with `//` followed by a space.
- The first word should be lowercase (e.g. `// file path` not `// File path`).
- The comment should end with a period (e.g. `// file path.`).

If-statements that only have one line of code should not have curly braces (e.g. `if (condition) return;`).

JSDoc comments should avoid starting with the word "The" (e.g. "The file path" should just be "File path").

JSDoc comments should avoid the hyphen character before the description (e.g. 
`@param {string} - File path` should be `@param {string} File path`).

JSDoc comments should NOT include the @throws tag used to document exceptions.

In JSDoc comments, the @returns tag should only specify the return type (e.g. `@returns {string}`). Information about
the return value should be in the main description of the function itself.

All files should have a blank line at the beginning and a blank line at the end.