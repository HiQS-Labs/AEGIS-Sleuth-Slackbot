'use strict';

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const fsSync = require('fs');

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

  describe('GH-111 drift pre-flight', () => {
    // Production could not report that it was behind: its fetch refspec was narrowed to a branch it
    // was not on, and `main` had no upstream, so `git status` looked clean at any drift. These cover
    // the reporting itself AND the two ways it must degrade — because the one thing worse than no
    // drift line is a drift line that can abort a deploy.
    const FakeBinDir = path.join(TestDir, 'fake-bin');

    /** Put a stub systemctl + npm on PATH so the script runs to completion without a real service. */
    function InstallFakeBinaries() {
      execSync(`
        mkdir -p "${FakeBinDir}"
        printf '#!/bin/bash\\nexit 0\\n' > "${FakeBinDir}/systemctl"
        printf '#!/bin/bash\\nexit 0\\n' > "${FakeBinDir}/npm"
        chmod +x "${FakeBinDir}/systemctl" "${FakeBinDir}/npm"
      `);
    }

    /**
     * Build a real checkout at MockAppDir wired to a local bare "origin" — no network involved.
     * @param {number} ArgCommitsAhead How many commits origin/main has that the checkout does not.
     */
    function BuildCheckoutBehindOriginBy(ArgCommitsAhead) {
      const OriginDir = path.join(TestDir, 'origin.git');
      const Git = `git -C "${MockAppDir}" -c user.email=t@t -c user.name=t -c commit.gpgsign=false`;
      // `git init -b main` needs git >= 2.28; DeployHQ's build image ships an older git and the
      // whole suite died in fixture setup there (GH-143 pipeline rebuild). symbolic-ref sets the
      // unborn branch name on any git version.
      execSync(`
        git init --quiet --bare "${OriginDir}"
        git --git-dir "${OriginDir}" symbolic-ref HEAD refs/heads/main
        git init --quiet "${MockAppDir}"
        git -C "${MockAppDir}" symbolic-ref HEAD refs/heads/main
      `);

      // THE GUARD THAT MUST NOT BE REMOVED.
      //
      // `git -C <dir>` does not fail when <dir> is not a repository — it walks UP until it finds
      // one. MockAppDir lives inside this repo, so if the init above silently fails (a sandboxed
      // shell denying the write, an ancient git rejecting a flag), every `${Git}` below retargets
      // the REAL repository and `add -A && commit -m base` commits the developer's whole working
      // tree onto whatever branch they have checked out.
      //
      // Not hypothetical: this happened three times on 2026-08-27 — commits authored `t <t@t>`
      // titled `base`, one of them 58 files, one of them on `main` — and read as a rogue agent
      // until the committer identity was traced back to this fixture.
      //
      // A test that cannot build its fixture must fail, never fall back to mutating the
      // repository it is being run from.
      const Toplevel = execSync(`git -C "${MockAppDir}" rev-parse --show-toplevel`, { encoding: 'utf8' }).trim();
      if(fsSync.realpathSync(Toplevel) !== fsSync.realpathSync(MockAppDir)) {
        throw new Error(
          `deploy-script fixture refused to run: ${MockAppDir} is not its own git repository ` +
          `(git resolved it to ${Toplevel}). Aborting rather than committing to the real repo.`
        );
      }

      execSync(`
        ${Git} add -A && ${Git} commit --quiet -m base
        ${Git} remote add origin "${OriginDir}"
        ${Git} push --quiet origin main
      `);
      if(ArgCommitsAhead > 0) {
        // build the commits, publish them all, THEN rewind the checkout — so origin/main ends up
        // exactly ArgCommitsAhead ahead. Pushing and rewinding one at a time does not: every
        // iteration after the first re-commits onto the rewound base, and the checkout finishes
        // one behind no matter how many rounds ran.
        for(let Index = 0; Index < ArgCommitsAhead; Index++)
          execSync(`${Git} commit --quiet --allow-empty -m "remote-${Index}"`);
        execSync(`${Git} push --quiet origin main`);
        execSync(`${Git} reset --quiet --hard HEAD~${ArgCommitsAhead}`);
      }
    }

    function RunDeploy() {
      return execSync(
        `PATH="${FakeBinDir}:$PATH" SLEUTH_APP_DIR="${MockAppDir}" bash "${DeployScriptPath}"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    }

    it('skips cleanly, and still deploys, when the app directory is not a git checkout', () => {
      // This is the DeployHQ case: an artifact upload, not a clone. It must not abort the deploy.
      InstallFakeBinaries();
      const Output = RunDeploy();

      expect(Output).toContain('[deploy] drift: skipped');
      expect(Output).toContain('is not a git checkout');
      expect(Output).toContain('[deploy] done');
    });

    it('reports no drift when the checkout already matches origin/main', () => {
      InstallFakeBinaries();
      BuildCheckoutBehindOriginBy(0);
      const Output = RunDeploy();

      expect(Output).toMatch(/\[deploy\] deployed: [0-9a-f]{7,} \(branch main\)/);
      expect(Output).toContain('[deploy] drift: none');
      expect(Output).toContain('[deploy] done');
    });

    it('reports the exact commit count when the checkout is behind origin/main', () => {
      InstallFakeBinaries();
      BuildCheckoutBehindOriginBy(3);
      const Output = RunDeploy();

      // the count is the whole point — an off-by-one here is indistinguishable from "current".
      expect(Output).toContain('[deploy] drift: 3 commit(s) behind origin/main');
      expect(Output).toMatch(/\[deploy\] origin\/main: [0-9a-f]{7,}/);
      expect(Output).toContain('[deploy] done');
    });
  });
});
