import { Inject, Injectable } from '@nestjs/common';
import {
  MODULES,
  MODULE_MAP,
  isModuleKey,
  type AppSettingsDto,
  type ModuleStatusDto,
  type UpdateSettingsInput,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { conflict, forbidden, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';

interface SettingsRow {
  restaurant_name_fa: string;
  currency: string;
  digit_mode: 'fa' | 'latin';
  timezone: string;
  locale: string;
  service_charge_percent: number;
  tax_percent: number;
  logo_url: string;
  address_fa: string;
  phone: string;
  email: string;
}

export interface ActingUser {
  userId: string;
  username: string;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  getSettings(): AppSettingsDto {
    const row =
      this.database.get<SettingsRow>(`SELECT * FROM settings WHERE id = 'singleton'`) ??
      ({
        restaurant_name_fa: 'کافه‌فلو',
        currency: 'IRR',
        digit_mode: 'fa',
        timezone: 'Asia/Tehran',
        locale: 'fa-IR',
        service_charge_percent: 0,
        tax_percent: 0,
        logo_url: '',
        address_fa: '',
        phone: '',
        email: '',
      } satisfies SettingsRow);

    return {
      restaurantNameFa: row.restaurant_name_fa,
      logoUrl: row.logo_url,
      addressFa: row.address_fa,
      phone: row.phone,
      email: row.email,
      currency: row.currency,
      digitMode: row.digit_mode,
      timezone: row.timezone,
      locale: row.locale,
      serviceChargePercent: row.service_charge_percent,
      taxPercent: row.tax_percent,
    };
  }

  updateSettings(input: UpdateSettingsInput, actor: ActingUser, meta: RequestMeta): AppSettingsDto {
    const before = this.getSettings();

    const columns: string[] = [];
    const values: unknown[] = [];
    const map: Array<[keyof UpdateSettingsInput, string]> = [
      ['restaurantNameFa', 'restaurant_name_fa'],
      ['digitMode', 'digit_mode'],
      ['serviceChargePercent', 'service_charge_percent'],
      ['taxPercent', 'tax_percent'],
      ['timezone', 'timezone'],
      ['logoUrl', 'logo_url'],
      ['addressFa', 'address_fa'],
      ['phone', 'phone'],
      ['email', 'email'],
    ];

    for (const [key, column] of map) {
      const value = input[key];
      if (value !== undefined) {
        columns.push(`${column} = ?`);
        values.push(value);
      }
    }

    if (columns.length === 0) return before;

    this.database.run(
      `UPDATE settings SET ${columns.join(', ')}, updated_at = ? WHERE id = 'singleton'`,
      [...values, new Date().toISOString()],
    );

    const after = this.getSettings();
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'settings.updated',
      entityType: 'settings',
      entityId: 'singleton',
      before,
      after,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return after;
  }

  listModules(): ModuleStatusDto[] {
    const rows = this.database.all<{ key: string; is_enabled: number }>(
      'SELECT key, is_enabled FROM module_settings',
    );
    const stored = new Map(rows.map((row) => [row.key, row.is_enabled === 1]));

    return MODULES.map((module) => ({
      key: module.key,
      nameFa: module.nameFa,
      descriptionFa: module.descriptionFa,
      enabled: stored.get(module.key) ?? module.defaultEnabled,
      configurable: module.configurable,
      phase: module.phase,
    }));
  }

  setModuleEnabled(
    key: string,
    enabled: boolean,
    actor: ActingUser,
    meta: RequestMeta,
  ): ModuleStatusDto {
    if (!isModuleKey(key)) throw notFound('ماژول درخواستی یافت نشد.');

    const definition = MODULE_MAP[key];
    if (!definition.configurable) {
      throw forbidden(
        `ماژول «${definition.nameFa}» بخشی از هسته سیستم است و قابل غیرفعال‌سازی نیست.`,
        'MODULE_NOT_CONFIGURABLE',
      );
    }

    const current = this.listModules();
    const currentState = current.find((module) => module.key === key);
    if (!currentState) throw notFound('ماژول درخواستی یافت نشد.');

    if (currentState.enabled === enabled) {
      return currentState;
    }

    if (enabled && definition.dependsOn.length > 0) {
      const disabledDependencies = definition.dependsOn.filter((dependency) => {
        const state = current.find((module) => module.key === dependency);
        return state ? !state.enabled : !MODULE_MAP[dependency].defaultEnabled;
      });

      if (disabledDependencies.length > 0) {
        const names = disabledDependencies.map((dependency) => MODULE_MAP[dependency].nameFa).join('، ');
        throw conflict(
          `برای فعال‌سازی «${definition.nameFa}» ابتدا ماژول‌های وابسته را فعال کنید: ${names}`,
          'MODULE_DEPENDENCY_DISABLED',
        );
      }
    }

    this.database.run(
      `INSERT INTO module_settings (key, is_enabled, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET is_enabled = excluded.is_enabled,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [key, enabled ? 1 : 0, actor.userId, new Date().toISOString()],
    );

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: enabled ? 'module.enabled' : 'module.disabled',
      entityType: 'module',
      entityId: key,
      before: { enabled: currentState.enabled },
      after: { enabled },
      metadata: { moduleNameFa: definition.nameFa },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { ...currentState, enabled };
  }
}
