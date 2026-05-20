export interface JiraConnection {
  id: string;
  name: string;
  authType: 'basic' | 'oauth';
  domain: string;
  email: string;
  apiToken: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  cloudId: string | null;
  isDefault: boolean;
  clientId?: string;
  clientSecret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JiraConnectionCreate {
  name: string;
  authType: 'basic' | 'oauth';
  domain: string;
  email?: string;
  apiToken?: string;
  isDefault?: boolean;
  clientId?: string;
  clientSecret?: string;
}
