const fs = require('fs').promises;
const path = require('path');

/**
 * Test read/write access for a directory by creating and deleting a temp file.
 * @param {string} dirPath Directory to test.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function TestDirectoryAccessAsync(dirPath) {
  try {
    const testFile = path.join(dirPath, `diag_${Date.now()}`);
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { TestDirectoryAccessAsync };
