import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api, setAccessToken, toQuery } from './api-client';

/**
 * O ponto crítico deste cliente é a renovação de sessão: um 401 tem que virar
 * um refresh + repetição transparente, e nunca um loop infinito.
 */
describe('cliente HTTP', () => {
  beforeEach(() => {
    setAccessToken('token-antigo');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setAccessToken(null);
  });

  it('monta querystring ignorando valores vazios', () => {
    expect(toQuery({ month: '2026-09', search: '', page: 2, categoryId: undefined })).toBe(
      '?month=2026-09&page=2',
    );
  });

  it('renova o token depois de um 401 e repete a chamada', async () => {
    const fetchMock = vi
      .fn()
      // 1ª chamada: token expirado
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'expirado' }), { status: 401 }))
      // 2ª: refresh bem-sucedido
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'token-novo' }), { status: 200 }),
      )
      // 3ª: repetição da original, agora autorizada
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/api/dashboard')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/auth/refresh');
  });

  it('não tenta renovar duas vezes quando o refresh falha', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/api/dashboard')).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('traduz erro de validação em mensagens por campo', async () => {
    // Cada chamada precisa de uma Response nova: o corpo só pode ser lido uma vez.
    const respostaInvalida = () =>
      new Response(
        JSON.stringify({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Alguns campos precisam de atenção.',
          details: [{ path: 'email', message: 'E-mail inválido.' }],
        }),
        { status: 400 },
      );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => respostaInvalida()),
    );

    await expect(api.post('/api/admin/users', {})).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });

    try {
      await api.post('/api/admin/users', {});
    } catch (error) {
      expect((error as ApiRequestError).fieldErrors).toEqual({ email: 'E-mail inválido.' });
    }
  });

  it('transforma falha de rede em erro tratável', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(api.get('/api/dashboard')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
