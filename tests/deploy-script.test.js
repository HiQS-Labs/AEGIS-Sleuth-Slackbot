'use strict';

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

describe('deploy.sh (GH-86 Phase 2)', () => {
  const TestDir = path.join(__dirname, '..', 'temp', 'test-deploy-script');
  const MockAppDir = path.join(TestDir, 'mock-app');
  const DeployScriptPath = path.join(__dirname, '..', 'scripts', 'deploy.sh');

  beforeEach(async () => {
    await fs.mkdir(path.join(MockAppDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(MockAppDir, 'src', 'app.js'), '// mock app.js');
    await fs.writeFile(path.join(MockAppDir, 'package.json'), '{}');
  });

  afterEach(async () => {
    await fs.rm(TestDir, { recursive: true, force: true });
  });

  it('fails loudly when neither systemctl nor SLEUTH_APP_DIR resolves', () => {
    // Create a fake PATH with a mock systemctl that outputs empty WorkingDirectory
    const FakeBinDir = path.join(TestDir, 'fake-bin');
    try {
      execSync(`
        mkdir -p "${FakeBinDir}"
        cat << 'EOF' > "${FakeBinDir}/systemctl"
#!/bin/bash
exit 1
EOF
        chmod +x "${FakeBinDir}/systemctl"
      `);

      let Threw = false;
      try {
        execSync(`PATH="${FakeBinDir}:$PATH" SLEUTH_APP_DIR="" bash "${DeployScriptPath}"`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch(error) {
        Threw = true;
        const Stderr = error.stderr ? error.stderr.toString() : '';
        expect(Stderr).toContain('app directory could not be resolved from systemd');
      }
      expect(Threw).toBe(true);
    } catch(error) {
      if(error.message && !error.message.includes('app directory could not be resolved')) {
        throw error;
      }
    }
  });

  it('resolves app directory from SLEUTH_APP_DIR when systemctl returns nothing', () => {
    const FakeBinDir = path.join(TestDir, 'fake-bin');
    execSync(`
      mkdir -p "${FakeBinDir}"
      cat << 'EOF' > "${FakeBinDir}/systemctl"
#!/bin/bash
if [[ "$*" == *"show sleuth-app -p WorkingDirectory --value"* ]]; then
  exit 1
fi
exit 0
EOF
      cat << 'EOF' > "${FakeBinDir}/npm"
#!/bin/bash
exit 0
EOF
      chmod +x "${FakeBinDir}/systemctl" "${FakeBinDir}/npm"
    `);

    const Output = execSync(
      `PATH="${FakeBinDir}:$PATH" SLEUTH_APP_DIR="${MockAppDir}" bash "${DeployScriptPath}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    expect(Output).toContain(`[deploy] target app directory: ${MockAppDir}`);
  });

  it('derives app directory from systemctl WorkingDirectory when available', () => {
    const FakeBinDir = path.join(TestDir, 'fake-bin');
    execSync(`
      mkdir -p "${FakeBinDir}"
      cat << 'EOF' > "${FakeBinDir}/systemctl"
#!/bin/bash
if [[ "$*" == *"show sleuth-app -p WorkingDirectory --value"* ]]; then
  echo "${MockAppDir}"
  exit 0
fi
exit 0
EOF
      cat << 'EOF' > "${FakeBinDir}/npm"
#!/bin/bash
exit 0
EOF
      chmod +x "${FakeBinDir}/systemctl" "${FakeBinDir}/npm"
    `);

    const Output = execSync(
      `PATH="${FakeBinDir}:$PATH" SLEUTH_APP_DIR="" bash "${DeployScriptPath}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    expect(Output).toContain(`[deploy] target app directory: ${MockAppDir}`);
  });
});
