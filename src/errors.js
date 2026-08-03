export class AppError extends Error {
  constructor(message, { status = 400, code = "BAD_REQUEST", field, retryable = false } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryable = retryable;
  }
}

export function validationError(message, field, code = "VALIDATION_ERROR") {
  return new AppError(message, { status: 400, code, field });
}
