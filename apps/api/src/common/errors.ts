import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ZodType } from 'zod';

/**
 * An error the client is allowed to see. Messages are Persian because they are
 * rendered directly in the interface; `code` is stable and machine-readable.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(code, 400, message, details);

export const unauthorized = (message = 'برای دسترسی باید وارد حساب خود شوید.', code = 'UNAUTHORIZED') =>
  new AppError(code, 401, message);

export const forbidden = (message = 'شما اجازه انجام این عملیات را ندارید.', code = 'FORBIDDEN') =>
  new AppError(code, 403, message);

export const notFound = (message = 'مورد درخواستی یافت نشد.', code = 'NOT_FOUND') =>
  new AppError(code, 404, message);

export const conflict = (message: string, code = 'CONFLICT', details?: unknown) =>
  new AppError(code, 409, message, details);

/** Validates input with a Zod schema and throws a Persian 400 on failure. */
export function parseWith<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      issue?.message ?? 'اطلاعات ارسالی معتبر نیست.',
      result.error.issues.map((item) => ({ path: item.path.join('.'), message: item.message })),
    );
  }
  return result.data;
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : typeof payload === 'object' && payload !== null && 'message' in payload
            ? Array.isArray((payload as { message: unknown }).message)
              ? ((payload as { message: string[] }).message[0] ?? 'درخواست معتبر نیست.')
              : String((payload as { message: unknown }).message)
            : 'درخواست معتبر نیست.';
      response.status(status).json({
        error: { code: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', message: status === 404 ? 'مسیر درخواستی یافت نشد.' : message },
      });
      return;
    }

    this.logger.error(
      `Unhandled error: ${exception instanceof Error ? exception.stack ?? exception.message : String(exception)}`,
    );
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.' },
    });
  }
}
