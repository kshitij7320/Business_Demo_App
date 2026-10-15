import fs from 'node:fs';
import path from 'node:path';

/**
 * Manages automated database snapshot backups and retention rotation.
 */
export class BackupManager {
  /**
   * @param {string} backupDir
   * @param {number} retentionCount
   */
  constructor(backupDir, retentionCount = 5) {
    this.backupDir = backupDir;
    this.retentionCount = retentionCount;
    this._ensureDirectory();
  }

  _ensureDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Creates a full snapshot backup of all collection data.
   * @param {Map<string, Map<string, any>>} collections
   * @returns {string} Backup directory name created
   */
  createBackup(collections) {
    this._ensureDirectory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetDir = path.join(this.backupDir, `backup-${timestamp}`);

    fs.mkdirSync(targetDir, { recursive: true });

    for (const [name, records] of collections.entries()) {
      const filePath = path.join(targetDir, `${name}.json`);
      const data = Array.from(records.values());
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    const metadata = {
      createdAt: new Date().toISOString(),
      collections: Array.from(collections.keys()),
      totalRecords: Array.from(collections.values()).reduce((sum, map) => sum + map.size, 0)
    };
    fs.writeFileSync(path.join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

    this.rotateBackups();
    return path.basename(targetDir);
  }

  /**
   * Rotates backups to maintain only the latest retentionCount directories.
   * Older backup directories are automatically deleted.
   * @returns {string[]} Names of pruned backup directories
   */
  rotateBackups() {
    this._ensureDirectory();
    const entries = fs.readdirSync(this.backupDir, { withFileTypes: true });
    const backupFolders = entries
      .filter(e => e.isDirectory() && e.name.startsWith('backup-'))
      .map(e => ({
        name: e.name,
        path: path.join(this.backupDir, e.name),
        time: fs.statSync(path.join(this.backupDir, e.name)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    const pruned = [];
    if (backupFolders.length > this.retentionCount) {
      const toRemove = backupFolders.slice(this.retentionCount);
      for (const item of toRemove) {
        fs.rmSync(item.path, { recursive: true, force: true });
        pruned.push(item.name);
      }
    }

    return pruned;
  }

  /**
   * Lists all existing backup snapshots ordered from newest to oldest.
   * @returns {Array<{ name: string, createdAt: string, totalRecords: number }>}
   */
  listBackups() {
    this._ensureDirectory();
    const entries = fs.readdirSync(this.backupDir, { withFileTypes: true });
    const list = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('backup-')) {
        const metaPath = path.join(this.backupDir, entry.name, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            list.push({
              name: entry.name,
              createdAt: meta.createdAt,
              totalRecords: meta.totalRecords
            });
          } catch {
            // Ignore incomplete backup
          }
        }
      }
    }

    return list.sort((a, b) => b.name.localeCompare(a.name));
  }
}
