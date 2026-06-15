/**
 * Error thrown for any non-2xx API response (or a network failure, with
 * `status === 0`). `data` carries the parsed error body when the server sent one,
 * which for NASEBANAL APIs is typically `{ error: { code, message } }`.
 */
export class SdkError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown,
  ) {
    super(message);
    this.name = "SdkError";
  }
}
