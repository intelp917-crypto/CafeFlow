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
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected'], { error: 'تصمیم باید تأیید یا رد باشد.' }),
  note: z.string().trim().max(500, 'توضیح بیش از حد طولانی است.').optional(),
});

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
