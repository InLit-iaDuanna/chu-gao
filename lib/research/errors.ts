export class ResearchError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: {
      retryable?: boolean;
      reason?: string;
      httpStatus?: number;
      usage?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "ResearchError";
  }
}
export const researchJson = <T>(value: T) => JSON.parse(JSON.stringify(value));
