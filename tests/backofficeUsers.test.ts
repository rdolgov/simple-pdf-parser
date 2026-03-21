import { describe, expect, it } from 'vitest';

import { isBackofficeAllowedUser, listBackofficeAllowedUsers } from '../server/src/backofficeUsers.js';

describe('backofficeUsers', () => {
  it('allows only the hardcoded backoffice usernames', () => {
    expect(isBackofficeAllowedUser('vesperz')).toBe(true);
    expect(isBackofficeAllowedUser('someone-else')).toBe(false);
    expect(listBackofficeAllowedUsers()).toContain('vesperz');
  });
});
