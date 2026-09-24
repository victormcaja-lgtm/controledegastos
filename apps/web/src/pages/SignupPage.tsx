import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { signupRequestSchema, type SignupRequest } from '@grana/shared';
import { AuthLayout } from '@/components/templates/AuthLayout';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { FormField } from '@/components/molecules/FormField';
import { granaGateway } from '@/infra/http/grana.gateway';
import { ApiRequestError } from '@/infra/http/api-client';

export function SignupPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequest>({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await granaGateway.signup(values);
      setSubmitted(true);
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError ? error.message : 'Não foi possível enviar agora.',
      );
    }
  });

  if (submitted) {
    return (
      <AuthLayout title="Solicitação enviada" subtitle="Falta pouco.">
        <p className="text-[13px] leading-relaxed text-soft">
          Um administrador precisa aprovar seu acesso antes que você possa entrar. Assim que isso
          acontecer, use o e-mail e a senha que você acabou de escolher para entrar normalmente.
        </p>
        <Link to="/entrar" className="mt-5 block">
          <Button variant="secondary" fullWidth>
            Voltar para o login
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Escolha seu e-mail e senha. Um administrador precisa aprovar antes de você conseguir entrar."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/entrar" className="font-medium text-green hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="Nome" error={errors.name?.message}>
          <Input autoComplete="name" placeholder="Seu nome completo" autoFocus {...register('name')} />
        </FormField>

        <FormField label="E-mail" error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com"
            {...register('email')}
          />
        </FormField>

        <FormField
          label="Senha"
          error={errors.password?.message}
          hint="Mínimo de 10 caracteres, com letra maiúscula, minúscula e número."
        >
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>

        {formError && (
          <p role="alert" className="rounded-xl bg-clay/10 px-3 py-2 text-[13px] text-clay">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          Solicitar acesso
        </Button>
      </form>
    </AuthLayout>
  );
}
