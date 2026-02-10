import { authService } from './auth';

const SERVER_BASE = process.env.REACT_APP_SERVER_URL || '';

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = authService.getToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const url = path.startsWith('http') ? path : `${SERVER_BASE}${path}`;

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    console.warn('⚠️ Sessão expirada, fazendo logout...');
    await authService.logout();
    window.location.reload();
    throw new Error('Sessão expirada');
  }

  return response;
}
