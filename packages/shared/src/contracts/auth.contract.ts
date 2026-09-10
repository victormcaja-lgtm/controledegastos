import { z } from 'zod';
import { emailSchema, idSchema, passwordSchema } from '../primitives.js';
import { userRoleSchema, userStatusSchema } from '../enums.js';

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha.').max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authenticatedUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

/**
 * O refresh token NÃO viaja no corpo: ele é gravado num cookie httpOnly.
 * Só o access token (curta duração) fica na memória do front.
 */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: authenticatedUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = loginResponseSchema;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas não conferem.',
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ['newPassword'],
    message: 'A nova senha precisa ser diferente da atual.',
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const updateProfileRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
