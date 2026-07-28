'use strict';

const { BuildAdminConfigValue } = require('../scripts/admin-setup');

describe('BuildAdminConfigValue', () => {
  const BaseOptions = {
    AdminEmail: 'admin@example.com',
    AdminPassword: 'supersecret123',
    AdminBaseUrl: 'http://localhost:2020/',
    EncryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };

  test('omits smtp block when SMTP password is blank', () => {
    const ConfigValue = BuildAdminConfigValue({
      ...BaseOptions,
      SmtpUser: '',
      SmtpAppPassword: '',
    });

    expect(ConfigValue.adminEmail).toBe('admin@example.com');
    expect(ConfigValue.adminBaseUrl).toBe('http://localhost:2020');
    expect(ConfigValue.passwordHash).toMatch(/^[0-9a-f]+$/i);
    expect(ConfigValue.passwordSalt).toMatch(/^[0-9a-f]+$/i);
    expect(ConfigValue.smtp).toBeUndefined();
  });

  test('includes smtp block when SMTP password is provided', () => {
    const ConfigValue = BuildAdminConfigValue({
      ...BaseOptions,
      SmtpUser: 'smtp@example.com',
      SmtpAppPassword: 'abcdefghijklmnop',
    });

    expect(ConfigValue.smtp).toEqual({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      authUser: 'smtp@example.com',
      authPassEncrypted: expect.any(String),
    });
  });
});
