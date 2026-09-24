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
  const [toReject, setToReject] = useState<UserDTO | null>(null);

  const { data, isPending } = useUsers({ page, perPage: 20, ...(search ? { search } : {}) });
  const { data: pending } = useUsers({ status: 'PENDING', page: 1, perPage: 50 });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPassword = useResetUserPassword();
  const deleteUser = useDeleteUser();

  function approve(user: UserDTO) {
    updateUser.mutate(
      { id: user.id, data: { status: 'ACTIVE' } },
      {
        onSuccess: () => show(`${user.name} aprovado`),
        onError: (error) =>
          showError(error instanceof ApiRequestError ? error.message : 'Não deu para aprovar.'),
      },
    );
  }

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
      {pending && pending.items.length > 0 && (
        <div className="mb-6 rounded-[22px] border border-clay/40 bg-clay/5 p-5">
          <p className="mb-3 text-sm font-semibold text-ink">
            Solicitações de acesso pendentes ({pending.items.length})
          </p>
          <ul className="flex flex-col gap-2.5">
            {pending.items.map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-[12px] text-muted">{user.email}</p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => approve(user)} loading={updateUser.isPending}>
                    Aprovar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setToReject(user)}>
                    Recusar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                            : user.status === 'PENDING'
                              ? 'bg-chip-strong text-soft'
                              : 'bg-clay/15 text-clay',
                        )}
                      >
                        {user.status === 'ACTIVE'
                          ? 'Ativo'
                          : user.status === 'PENDING'
                            ? 'Pendente'
                            : 'Suspenso'}
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
                          {user.status === 'ACTIVE'
                            ? 'Suspender'
                            : user.status === 'PENDING'
                              ? 'Aprovar'
                              : 'Reativar'}
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

      <ConfirmDialog
        open={toReject !== null}
        title={`Recusar o acesso de ${toReject?.name ?? ''}?`}
        description="A solicitação é descartada. A pessoa pode se cadastrar de novo se quiser tentar outra vez."
        confirmLabel="Recusar"
        destructive
        loading={deleteUser.isPending}
        onConfirm={async () => {
          if (!toReject) return;
          try {
            await deleteUser.mutateAsync(toReject.id);
            show('Solicitação recusada');
          } catch (error) {
            showError(error instanceof ApiRequestError ? error.message : 'Não deu para recusar.');
          } finally {
            setToReject(null);
          }
        }}
        onCancel={() => setToReject(null)}
      />
    </AdminLayout>
  );
}
