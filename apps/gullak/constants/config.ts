// Santha store API, fronted by Caddy (HTTPS) → localhost:3000 on the VPS
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://santha.t3ja.com';

// Low-privilege app key — sent as x-api-key so the server (and Caddy) accept finance
// requests without the browser basic-auth prompt. Injected at build via CI.
export const STORE_KEY = process.env.EXPO_PUBLIC_STORE_KEY ?? '';
