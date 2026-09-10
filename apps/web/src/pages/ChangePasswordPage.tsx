import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { changePasswordRequestSchema, type ChangePasswordRequest } from '@grana/shared';
import { AuthLayout } from '@/components/templates/AuthLayout';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { FormField } from '@/components/molecules/FormField';
import { granaGateway } from '@/infra/http/grana.gateway';
import { ApiRequestError } from '@/infra/http/api-client';
import { useAuthStore } from '@/application/auth/auth.store';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(changePasswordRequestSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await granaGateway.changePassword(values);
      // Trocar a senha derruba todas as sessões — inclusive esta. É o esperado.
      setDone(true);
      setTimeout(() => {
        void logout().then(() => navigate('/entrar', { replace: true }));
      }, 1600);
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError ? error.message : 'Não foi possível trocar a senha.',
      );
    }
  });

  if (done) {
    return (
      <AuthLayout title="Senha atualizada" subtitle="Entre novamente com a nova senha.">
        <p className="text-[13px] text-soft">Redirecionando para o login…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Criar uma nova senha"
      subtitle="Mínimo de 10 caracteres, com letra maiúscula, minúscula e número."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="Senha atual" error={errors.currentPassword?.message}>
          <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
        </FormField>

        <FormField label="Nova senha" error={errors.newPassword?.message}>
          <Input type="password" autoComplete="new-password" {...register('newPassword')} />
        </FormField>

        <FormField label="Repita a nova senha" error={errors.confirmPassword?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirmPassword')} />
        </FormField>

        {formError && (
          <p role="alert" className="rounded-xl bg-clay/10 px-3 py-2 text-[13px] text-clay">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  );
}
