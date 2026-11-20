import { z } from 'zod';

export const usernameSchema = z
  .string({ error: 'نام کاربری الزامی است.' })
  .trim()
  .min(3, 'نام کاربری باید حداقل ۳ نویسه باشد.')
  .max(64, 'نام کاربری بیش از حد طولانی است.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد.');

export const passwordSchema = z
  .string({ error: 'گذرواژه الزامی است.' })
  .min(8, 'گذرواژه باید حداقل ۸ نویسه باشد.')
  .max(128, 'گذرواژه بیش از حد طولانی است.');

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string({ error: 'گذرواژه الزامی است.' }).min(1, 'گذرواژه الزامی است.'),
  /** TOTP code (6 digits) or a one-time recovery code (`XXXX-XXXX`). */
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Za-z2-7]{4}-?[A-Za-z2-7]{4})$/, 'کد تأیید باید ۶ رقم یا کد پشتیبان باشد.')
    .optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: 'گذرواژه فعلی الزامی است.' }).min(1, 'گذرواژه فعلی الزامی است.'),
    newPassword: passwordSchema,
    confirmPassword: z.string({ error: 'تکرار گذرواژه الزامی است.' }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'تکرار گذرواژه با گذرواژه جدید مطابقت ندارد.',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const toggleModuleSchema = z.object({
  enabled: z.boolean({ error: 'وضعیت ماژول باید مشخص باشد.' }),
});

export type ToggleModuleInput = z.infer<typeof toggleModuleSchema>;

export const updateSettingsSchema = z.object({
  restaurantNameFa: z.string().trim().min(1, 'نام رستوران الزامی است.').max(120).optional(),
  digitMode: z.enum(['fa', 'latin']).optional(),
  serviceChargePercent: z.number().int().min(0).max(30).optional(),
  taxPercent: z.number().int().min(0).max(30).optional(),
  timezone: z.string().min(3).max(64).optional(),
  /** PNG, JPEG or WebP logo as a data URL; empty string removes it. */
  logoUrl: z
    .string()
    .max(300_000, 'حجم لوگو بیش از حد بزرگ است (حداکثر ۲۲۰ کیلوبایت).')
    .regex(/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)?$/, 'فرمت لوگو معتبر نیست (PNG، JPEG یا WebP).')
    .optional(),
  addressFa: z.string().trim().max(300, 'نشانی بیش از حد طولانی است.').optional(),
  phone: z.string().trim().max(32, 'شماره تماس بیش از حد طولانی است.').optional(),
  email: z.string().trim().max(120).email('ایمیل معتبر نیست.').or(z.literal('')).optional(),
  /** Null clears the pin; latitude and longitude must always move together. */
  latitude: z
    .number()
    .min(-90, 'عرض جغرافیایی باید بین ۹۰- و ۹۰ باشد.')
    .max(90, 'عرض جغرافیایی باید بین ۹۰- و ۹۰ باشد.')
    .nullable()
    .optional(),
  longitude: z
    .number()
    .min(-180, 'طول جغرافیایی باید بین ۱۸۰- و ۱۸۰ باشد.')
    .max(180, 'طول جغرافیایی باید بین ۱۸۰- و ۱۸۰ باشد.')
    .nullable()
    .optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected'], { error: 'تصمیم باید تأیید یا رد باشد.' }),
  note: z.string().trim().max(500, 'توضیح بیش از حد طولانی است.').optional(),
});

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

/* ------------------------ two-factor authentication ------------------------ */

export const mfaCodeSchema = z.object({
  code: z
    .string({ error: 'کد تأیید الزامی است.' })
    .trim()
    .regex(/^\d{6}$/, 'کد تأیید باید ۶ رقم باشد.'),
});
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

export const mfaDisableSchema = z.object({
  password: z.string({ error: 'گذرواژه الزامی است.' }).min(1, 'گذرواژه الزامی است.'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'کد تأیید باید ۶ رقم باشد.')
    .optional(),
});
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

export interface MfaStatus {
  enabled: boolean;
  confirmedAt: string | null;
}

export interface MfaEnrollment {
  secret: string;
  otpauthUrl: string;
}

export interface MfaActivation {
  enabled: true;
  confirmedAt: string;
  /** Shown exactly once; only hashes are stored server-side. */
  recoveryCodes: string[];
}

export const mfaRecoverySchema = z.object({
  password: z.string({ error: 'گذرواژه الزامی است.' }).min(1, 'گذرواژه الزامی است.'),
  code: z
    .string({ error: 'کد تأیید الزامی است.' })
    .trim()
    .regex(/^\d{6}$/, 'کد تأیید باید ۶ رقم باشد.'),
});
export type MfaRecoveryInput = z.infer<typeof mfaRecoverySchema>;
