'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const AdminAuth = require('../src/admin-auth');

describe('AdminAuth.IsConfiguredAsync', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns true when admin auth file exists and is readable/writable', async () => {
    const TempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sleuth-admin-auth-'));
    const ConfigFilePath = path.join(TempDirPath, 'admin-auth.json');
    await fs.writeFile(ConfigFilePath, '{"ok":true}', 'utf8');

    jest.spyOn(AdminAuth, 'GetConfigFilePath').mockReturnValue(ConfigFilePath);
    const Auth = new AdminAuth();

    await expect(Auth.IsConfiguredAsync()).resolves.toBe(true);

    await fs.rm(TempDirPath, { recursive: true, force: true });
  });

  test('returns false when admin auth file does not exist', async () => {
    const TempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sleuth-admin-auth-'));
    const ConfigFilePath = path.join(TempDirPath, 'missing-admin-auth.json');

    jest.spyOn(AdminAuth, 'GetConfigFilePath').mockReturnValue(ConfigFilePath);
    const Auth = new AdminAuth();

    await expect(Auth.IsConfiguredAsync()).resolves.toBe(false);

    await fs.rm(TempDirPath, { recursive: true, force: true });
  });
});
