const BACKOFFICE_ALLOWED_USERS = new Set([
  'vesperz'
]);

export function isBackofficeAllowedUser(username: string | null | undefined): boolean {
  return typeof username === 'string' && BACKOFFICE_ALLOWED_USERS.has(username.trim());
}

export function listBackofficeAllowedUsers(): string[] {
  return [...BACKOFFICE_ALLOWED_USERS];
}
