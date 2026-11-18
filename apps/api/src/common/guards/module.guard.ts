import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_MAP, isModuleKey } from '@cafeflow/shared';
import { DB_SERVICE } from '../tokens';
import { DatabaseService } from '../../db/database.service';
import { MODULE_KEY } from '../decorators';
import { forbidden } from '../errors';

/**
 * Blocks a route when its optional module is disabled.
 *
 * Disabled modules must be unreachable through the API even when a client
 * guesses the endpoint: toggling a switch is a UI convenience, the guard is
 * the enforcement point.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const moduleKey = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleKey) return true;

    if (!isModuleKey(moduleKey)) {
      throw forbidden('ماژول درخواستی شناخته نشد.', 'UNKNOWN_MODULE');
    }

    const row = this.database.get<{ is_enabled: number }>(
      'SELECT is_enabled FROM module_settings WHERE key = ?',
      [moduleKey],
    );
    const enabled = row ? row.is_enabled === 1 : MODULE_MAP[moduleKey].defaultEnabled;

    if (!enabled) {
      throw forbidden(
        `ماژول «${MODULE_MAP[moduleKey].nameFa}» غیرفعال است. برای استفاده، آن را از تنظیمات ماژول‌ها فعال کنید.`,
        'MODULE_DISABLED',
      );
    }
    return true;
  }
}
