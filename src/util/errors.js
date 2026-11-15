/** 统一错误：带 HTTP 状态码与机器可读 code，方便 API 消费方判断。 */
export class AppError extends Error {
  constructor(code, message, status = 400, extra = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.extra ? { details: this.extra } : {}) };
  }
}

export const badRequest = (msg, details) => new AppError('bad_request', msg, 400, details);
export const unauthorized = (msg = '需要有效的 API Token') => new AppError('unauthorized', msg, 401);
export const forbidden = (msg = '禁止访问该资源') => new AppError('forbidden', msg, 403);
export const notFound = (msg = '资源不存在') => new AppError('not_found', msg, 404);
export const tooMany = (msg = '请求过于频繁，请稍后再试', retryAfter = 60) =>
  new AppError('rate_limited', msg, 429, { retryAfter });
export const upstream = (msg, details) => new AppError('upstream_error', msg, 502, details);
export const timeout = (msg = '目标站点响应超时') => new AppError('upstream_timeout', msg, 504);
export const internal = (msg = '服务内部错误') => new AppError('internal_error', msg, 500);
