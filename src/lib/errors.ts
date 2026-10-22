/** An error the API can show to a caller: carries the HTTP status and a stable code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Sign in required.") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Your role cannot do this.") => new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found.") => new AppError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
