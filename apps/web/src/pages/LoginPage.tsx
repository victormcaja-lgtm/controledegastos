import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { loginRequestSchema, type LoginRequest } from '@grana/shared';
import { AuthLayout } from '@/components/templates/AuthLayout';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { FormField } from '@/components/molecules/FormField';
import { useAuthStore } from '@/application/auth/auth.store';
import { ApiRequestError } from '@/infra/http/api-client';

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values);
      // Senha provisória criada pelo admin: troca obrigatória antes de usar o app.
      navigate(user.mustChangePassword ? '/trocar-senha' : '/', { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError ? error.message : 'Não foi possível entrar agora.',
      );
    }
  });

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Use o e-mail e a senha que o administrador cadastrou para você."
      footer="Esqueceu a senha? Peça ao administrador para redefinir."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="E-mail" error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com"
            autoFocus
            {...register('email')}
          />
        </FormField>

        <FormField label="Senha" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </FormField>

        {formError && (
          <p role="alert" className="rounded-xl bg-clay/10 px-3 py-2 text-[13px] text-clay">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
