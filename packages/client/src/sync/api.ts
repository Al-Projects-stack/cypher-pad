export interface PushPayload {
  id: string;
  baseRevision: number;
  revision: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
}

export interface ServerVersion {
  revision: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  updatedAt: string;
}

export interface PushResult {
  applied: Array<{ id: string; revision: number }>;
  conflicts: Array<{ id: string; server: ServerVersion | null }>;
}

export interface PulledChange extends ServerVersion {
  id: string;
}

export interface PullResult {
  changes: PulledChange[];
  nextCursor: string;
}

export interface VaultBlobs {
  salt: string;
  kdfIterations: number;
  kdfHash: string;
  kdfAlgorithm: string;
  kdfVersion: number;
  wrappedVaultIv: string;
  wrappedVaultData: string;
  wrappedRecoveryIv?: string;
  wrappedRecoveryData?: string;
}

export interface RegisterInput {
  email: string;
  salt: string;
  kdfIterations: number;
  authKey: string;
  wrappedVaultIv: string;
  wrappedVaultData: string;
  wrappedRecoveryIv?: string;
  wrappedRecoveryData?: string;
  recoveryAuth?: string;
}

export interface ChangePasswordInput {
  newSalt: string;
  newKdfIterations: number;
  newAuthKey: string;
  newWrappedVaultIv: string;
  newWrappedVaultData: string;
}

export interface RecoverInput {
  email: string;
  recoveryAuth: string;
  newSalt: string;
  newKdfIterations: number;
  newAuthKey: string;
  newWrappedVaultIv: string;
  newWrappedVaultData: string;
}

export interface RotateRecoveryInput {
  newWrappedRecoveryIv: string;
  newWrappedRecoveryData: string;
  newRecoveryVerifier: string;
}

export interface RotateRecoveryInput {
  newWrappedRecoveryIv: string;
  newWrappedRecoveryData: string;
  newRecoveryVerifier: string;
}

export interface RecoveryStart {
  salt: string;
  kdfIterations: number;
  wrappedRecoveryIv: string;
  wrappedRecoveryData: string;
}

export class SyncHttpError extends Error {
  status: number;
  body: PushResult | null;

  constructor(status: number, message: string, body: PushResult | null = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class SyncClient {
  baseUrl: string;
  getToken: () => string | null;

  constructor(baseUrl: string, getToken: () => string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.getToken = getToken;
  }

  private async request(path: string, init: RequestInit, auth: boolean): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) {
      const token = this.getToken();
      if (!token) throw new SyncHttpError(401, 'Not linked');
      headers['authorization'] = `Bearer ${token}`;
    }
    return fetch(`${this.baseUrl}${path}`, { ...init, headers, credentials: 'include' });
  }

  private async readError(res: Response): Promise<SyncHttpError> {
    try {
      await res.json();
    } catch {
      void 0;
    }
    return new SyncHttpError(res.status, 'Sync request failed');
  }

  async prelogin(email: string): Promise<{ salt: string; kdfIterations: number }> {
    const res = await this.request('/auth/prelogin', { method: 'POST', body: JSON.stringify({ email }) }, false);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as { salt: string; kdfIterations: number };
  }

  async register(input: RegisterInput): Promise<{ userId: string; accessToken: string }> {
    const res = await this.request('/auth/register', { method: 'POST', body: JSON.stringify(input) }, false);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as { userId: string; accessToken: string };
  }

  async recoveryStart(email: string): Promise<RecoveryStart> {
    const res = await this.request('/auth/recovery/start', { method: 'POST', body: JSON.stringify({ email }) }, false);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as RecoveryStart;
  }

  async recover(input: RecoverInput): Promise<{ userId: string; accessToken: string }> {
    const res = await this.request('/auth/recover', { method: 'POST', body: JSON.stringify(input) }, false);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as { userId: string; accessToken: string };
  }

  async changePassword(input: ChangePasswordInput): Promise<{ userId: string; accessToken: string }> {
    const res = await this.request('/auth/change_password', { method: 'POST', body: JSON.stringify(input) }, true);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as { userId: string; accessToken: string };
  }

  async rotateRecovery(input: RotateRecoveryInput): Promise<{ ok: boolean }> {
    const res = await this.request('/auth/recovery/rotate', { method: 'POST', body: JSON.stringify(input) }, true);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as { ok: boolean };
  }

  async login(email: string, authKey: string): Promise<{ userId: string; accessToken: string }> {
    const res = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, authKey }) }, false);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as { userId: string; accessToken: string };
  }

  async refresh(): Promise<{ userId: string; accessToken: string }> {
    const res = await this.request('/auth/refresh', { method: 'POST', body: '{}' }, false);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as { userId: string; accessToken: string };
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST', body: '{}' }, false).catch(() => undefined);
  }

  async getVault(): Promise<VaultBlobs> {
    const res = await this.request('/auth/vault', { method: 'GET' }, true);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as VaultBlobs;
  }

  async push(notes: PushPayload[]): Promise<PushResult> {
    const res = await this.request('/sync/push', { method: 'POST', body: JSON.stringify({ notes }) }, true);
    if (res.status === 409) {
      const body = (await res.json()) as PushResult;
      throw new SyncHttpError(409, 'Sync conflict', body);
    }
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as PushResult;
  }

  async pull(cursor: string): Promise<PullResult> {
    const res = await this.request(`/sync/pull?cursor=${encodeURIComponent(cursor)}`, { method: 'GET' }, true);
    if (!res.ok) throw await this.readError(res);
    return (await res.json()) as PullResult;
  }
}
