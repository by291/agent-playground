export class SubmissionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 409,
  ) {
    super(message);
  }
}
