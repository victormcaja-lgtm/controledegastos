import '@testing-library/jest-dom/vitest';

// A API de ambiente do Vite não existe em ambiente de teste puro.
Object.assign(import.meta.env, { VITE_API_URL: 'http://localhost:3333' });
