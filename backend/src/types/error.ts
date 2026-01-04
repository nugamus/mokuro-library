export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';

    // Restoration of prototype chain is required when extending built-ins in TS/JS
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}
