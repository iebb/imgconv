export type ErrorCode =
  | "errorDimensions"
  | "errorTiff"
  | "errorDecode"
  | "errorEncode"
  | "errorLimitFixed"
  | "errorLimitTiny"
  | "errorLimit"
  | "errorWorker"
  | "invalidNumber"
  | "errorAnimation"
  | "errorAnimationFormat"
  | "errorAnimationLimit"
  | "errorAI"
  | "errorWatermark";
export interface Issue {
  code: ErrorCode;
  params: Record<string, string | number>;
}

export class AppError extends Error {
  code: ErrorCode;
  params: Record<string, string | number>;
  constructor(code: ErrorCode, params: Record<string, string | number> = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

export function issue(
  error: unknown,
  fallback: ErrorCode = "errorDecode",
): Issue {
  return error instanceof AppError
    ? { code: error.code, params: error.params }
    : { code: fallback, params: {} };
}
