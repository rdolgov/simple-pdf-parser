declare module 'openai' {
  export interface OpenAIConfig {
    apiKey: string;
  }

  export default class OpenAI {
    constructor(config: OpenAIConfig);
    responses: {
      create(input: Record<string, unknown>): Promise<any>;
    };
  }
}
