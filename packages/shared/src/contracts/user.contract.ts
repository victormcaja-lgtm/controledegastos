import { z } from 'zod';
import { emailSchema, idSchema, paginationQuerySchema, passwordSchema } from '../primitives.js';
import { userRoleSchema, userStatusSchema } from '../enums.js';

export const userSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserDTO = z.infer<typeof userSchema>;

export const createUserRequestSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome completo.').max(80),
  email: emailSchema,
  password: passwordSchema,
  role: userRoleSchema.default('USER'),
  /** Força a troca de senha no primeiro acesso. Padrão: true. */
  mustChangePassword: z.boolean().default(true),
  /** Cria as categorias padrão para o novo usuário. Padrão: true. */
  seedDefaultCategories: z.boolean().default(true),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    email: emailSchema.optional(),
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const resetUserPasswordRequestSchema = z.object({
  newPassword: passwordSchema,
  mustChangePassword: z.boolean().default(true),
});
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const auditLogSchema = z.object({
  id: idSchema,
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  ip: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type AuditLogDTO = z.infer<typeof auditLogSchema>;
