declare module 'better-sqlite3' {
  class Database {
    constructor(path: string, options?: Database.Options);
    close(): void;
    exec(sql: string): this;
    loadExtension(path: string): void;
    pragma(sql: string): unknown;
    prepare<Result = unknown>(sql: string): Database.Statement<Result>;
  }

  namespace Database {
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface Statement<Result = unknown> {
      all(...params: unknown[]): Result[];
      get(...params: unknown[]): Result | undefined;
      run(...params: unknown[]): RunResult;
    }

    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      verbose?: (...args: unknown[]) => void;
    }
  }

  export = Database;
}
