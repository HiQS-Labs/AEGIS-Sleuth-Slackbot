declare module '@anthropic-ai/sdk' {
  export class Anthropic {
    constructor(options?: { apiKey?: string });
    messages: {
      create(request: unknown): Promise<unknown>;
    };
    models: {
      list(): AsyncIterable<{ id?: string }>;
    };
  }
}
