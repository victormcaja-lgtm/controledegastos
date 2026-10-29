import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { MODULES } from '../src/plan.js';

const base = {
  VERIFICADOR_URL_NODE: 'http://node:3334/',
  VERIFICADOR_URL_DOTNET: 'http://dotnet:8080',
  VERIFICADOR_DATABASE_URL: 'postgresql://x',
  VERIFICADOR_JWT_SECRET: 'segredo',
};

describe('loadConfig', () => {
  it('aplica os padrões', () => {
    const config = loadConfig(base, new Date('2026-10-26T23:30:00Z'));
    expect(config.nodeUrl).toBe('http://node:3334');
    expect(config.sampleSize).toBe(50);
    expect(config.modules).toEqual([...MODULES]);
    expect(config.today).toBe('2026-10-26');
    expect(config.seed).toMatch(/^[0-9a-f]{8}$/);
  });

  it('lê módulos, amostra, semente e hoje', () => {
    const config = loadConfig({
      ...base,
      VERIFICADOR_MODULOS: 'Settings, Incomes',
      VERIFICADOR_AMOSTRA: '10',
      VERIFICADOR_SEMENTE: 'abc',
      VERIFICADOR_HOJE: '2026-01-31',
    });
    expect(config.modules).toEqual(['Settings', 'Incomes']);
    expect(config.sampleSize).toBe(10);
    expect(config.seed).toBe('abc');
    expect(config.today).toBe('2026-01-31');
  });

  it('recusa configuração inválida', () => {
    expect(() => loadConfig({ ...base, VERIFICADOR_URL_NODE: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, VERIFICADOR_MODULOS: 'Pix' })).toThrow(/Pix/);
    expect(() => loadConfig({ ...base, VERIFICADOR_AMOSTRA: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, VERIFICADOR_HOJE: '26/10/2026' })).toThrow(ConfigError);
  });
});
