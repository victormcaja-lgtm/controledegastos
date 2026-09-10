import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { clsx } from 'clsx';
import { createUserRequestSchema, type UserDTO } from '@grana/shared';
import type { z } from 'zod';
import { AdminLayout } from '@/components/templates/AdminLayout';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Spinner } from '@/components/atoms/Spinner';
import { EmptyState } from '@/components/atoms/EmptyState';
import { FormField } from '@/components/molecules/FormField';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import {
  useCreateUser,
  useDeleteUser,
  useResetUserPassword,
  useUpdateUser,
  useUsers,
} from '@/application/hooks/queries';
import { useAuthStore } from '@/application/auth/auth.store';
import { useToast } from '@/application/toast/ToastProvider';
import { ApiRequestError } from '@/infra/http/api-client';

/**
 * O formulário trabalha com a ENTRADA do schema (campos com default são
 * opcionais); a API recebe a saída já normalizada pelo Zod.
 */
type NewUserForm = z.input<typeof createUserRequestSchema>;

/**
 * Painel administrativo.
 *
 * Ele gerencia CONTAS, não finanças: nem o administrador enxerga os
 * lançamentos de outra pessoa. Separar as duas coisas é uma decisão de
 * privacidade, não uma limitação técnica.
 */
export function UsersPage() {
  const currentUser = useAuthStore((state) => state.user);
  const { show, showError } = useToast();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<UserDTO | null>(null);

  const { data, isPending } = useUsers({ page, perPage: 20, ...(search ? { search } : {}) });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPassword = useResetUserPassword();
  const deleteUser = useDeleteUser();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewUserForm>({
    resolver: zodResolver(createUserRequestSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      role: 'USER',
      mustChangePassword: true,
      seedDefaultCategories: true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const created = await createUser.mutateAsync(createUserRequestSchema.parse(values));
      show(`${created.name} cadastrado`);
      reset();
      setFormOpen(false);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        // Erros por campo voltam da API já mapeados; os demais viram toast.
        const fieldErrors = error.fieldErrors;
        const keys = Object.keys(fieldErrors);
        if (keys.length > 0) {
          for (const key of keys) {
            setError(key as keyof NewUserForm, { message: fieldErrors[key] });
          }
          return;
        }
        showError(error.message);
        return;
      }
      showError('Não deu para cadastrar agora.');
    }
  });

  async function handleResetPassword(user: UserDTO) {
    const newPassword = window.prompt(
      `Nova senha provisória para ${user.name} (mínimo 10 caracteres, com maiúscula, minúscula e número):`,
    );
    if (!newPassword) return;

    try {
      await resetPassword.mutateAsync({ id: user.id, newPassword });
      show('Senha redefinida. As sessões dele foram encerradas.');
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para redefinir.');
    }
  }

  return (
    <AdminLayout
      title="Usuários"
      description="Cadastre pessoas, defina o perfil e controle o acesso ao sistema."
      actions={
        <Button onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? 'Fechar' : 'Novo usuário'}
        </Button>
      }
    >
      {formOpen && (
        <form
          onSubmit={onSubmit}
          className="mb-6 grid gap-4 rounded-[22px] border border-line bg-card p-5 sm:grid-cols-2"
        >
          <FormField label="Nome completo" error={errors.name?.message}>
            <Input placeholder="Maria Silva" {...register('name')} />
          </FormField>

          <FormField label="E-mail" error={errors.email?.message}>
            <Input type="email" placeholder="maria@empresa.com" {...register('email')} />
          </FormField>

          <FormField
            label="Senha provisória"
            error={errors.password?.message}
            hint="A pessoa será obrigada a trocar no primeiro acesso."
          >
            <Input type="text" autoComplete="off" {...register('password')} />
          </FormField>

          <FormField label="Perfil" error={errors.role?.message}>
            <select
              {...register('role')}
              className="h-11 w-full rounded-xl border border-line bg-card px-3 text-sm"
            >
              <option value="USER">Usuário</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </FormField>

          <div className="sm:col-span-2">
            <Button type="submit" loading={isSubmitting}>
              Cadastrar usuário
            </Button>
          </div>
        </form>
      )}

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Buscar por nome ou e-mail"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          aria-label="Buscar usuários"
        />
      </div>

      {isPending ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Nenhum usuário encontrado"
          description="Ajuste a busca ou cadastre alguém."
        />
      ) : (
        <div className="overflow-x-auto rounded-[22px] border border-line bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-[12px] text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Perfil</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Último acesso</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <tr key={user.id} className="border-b border-line-soft last:border-0">
                    <td className="px-5 py-3.5">
                      <p className="font-medium">
                        {user.name}
                        {isSelf && <span className="ml-2 text-[11px] text-muted">(você)</span>}
                      </p>
                      <p className="text-[12px] text-muted">{user.email}</p>
                    </td>

                    <td className="px-5 py-3.5">
                      <select
                        value={user.role}
                        disabled={isSelf}
                        onChange={(event) =>
                          updateUser.mutate(
                            { id: user.id, data: { role: event.target.value as 'ADMIN' | 'USER' } },
                            {
                              onSuccess: () => show('Perfil atualizado'),
                              onError: (error) =>
                                showError(
                                  error instanceof ApiRequestError
                                    ? error.message
                                    : 'Não deu para atualizar.',
                                ),
                            },
                          )
                        }
                        className="h-9 rounded-lg border border-line bg-card px-2 text-[13px] disabled:opacity-50"
                      >
                        <option value="USER">Usuário</option>
                        <option value="ADMIN">Administrador</option>
                      </select>
                    </td>

                    <td className="px-5 py-3.5">
                      <span
                        className={clsx(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          user.status === 'ACTIVE'
                            ? 'bg-mint/25 text-green'
                            : 'bg-clay/15 text-clay',
                        )}
                      >
                        {user.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-[12.5px] text-muted">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString('pt-BR')
                        : 'nunca entrou'}
                    </td>

                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isSelf}
                          onClick={() =>
                            updateUser.mutate(
                              {
                                id: user.id,
                                data: { status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                              },
                              {
                                onSuccess: () =>
                                  show(
                                    user.status === 'ACTIVE'
                                      ? 'Acesso suspenso'
                                      : 'Acesso liberado',
                                  ),
                                onError: (error) =>
                                  showError(
                                    error instanceof ApiRequestError
                                      ? error.message
                                      : 'Não deu para atualizar.',
                                  ),
                              },
                            )
                          }
                        >
                          {user.status === 'ACTIVE' ? 'Suspender' : 'Reativar'}
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleResetPassword(user)}
                        >
                          Redefinir senha
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isSelf}
                          onClick={() => setToDelete(user)}
                        >
                          Excluir
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-[13px]">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </Button>
          <span className="text-muted">
            página {data.page} de {data.totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Excluir ${toDelete?.name ?? ''}?`}
        description="Todo o dado financeiro dessa pessoa é apagado junto, em definitivo."
        confirmLabel="Excluir"
        destructive
        loading={deleteUser.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteUser.mutateAsync(toDelete.id);
            show('Usuário excluído');
          } catch (error) {
            showError(error instanceof ApiRequestError ? error.message : 'Não deu para excluir.');
          } finally {
            setToDelete(null);
          }
        }}
        onCancel={() => setToDelete(null)}
      />
    </AdminLayout>
  );
}
