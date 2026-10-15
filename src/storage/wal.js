import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StorageCorruptionError } from '../core/errors.js';

/**
 * Write-Ahead Log (WAL) Manager.
 * Provides durability, crash-resilience, and transactional replay capabilities.
 */
export class WriteAheadLog {
  /**
   * @param {string} walDirectory
   */
  constructor(walDirectory) {
    this.directory = walDirectory;
    this.filePath = path.join(walDirectory, 'wal.log');
    this.sequence = 0;
    this._fd = null;
    this._ensureDirectory();
  }

  _ensureDirectory() {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
  }

  /**
   * Opens the WAL file descriptor for append mode.
   */
  open() {
    if (!this._fd) {
      this._fd = fs.openSync(this.filePath, 'a+');
    }
  }

  /**
   * Computes SHA-256 digest of serialized payload string.
   * @param {string} rawString
   * @returns {string}
   */
  _computeHash(rawString) {
    return crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');
  }

  /**
   * Appends an entry to the WAL file with immediate synchronization.
   * @param {object} entry
   * @param {string} entry.txId
   * @param {'INSERT'|'UPDATE'|'DELETE'|'TX_BEGIN'|'TX_COMMIT'|'TX_ROLLBACK'} entry.op
   * @param {string} entry.collection
   * @param {string} [entry.key]
   * @param {any} [entry.data]
   * @returns {number} The entry sequence number
   */
  append(entry) {
    this.open();
    this.sequence += 1;

    const payload = {
      seq: this.sequence,
      timestamp: new Date().toISOString(),
      ...entry
    };

    const serialized = JSON.stringify(payload);
    const checksum = this._computeHash(serialized);
    const line = `${checksum} ${serialized}\n`;

    fs.writeSync(this._fd, line);
    // Explicit sync to disk to prevent data loss across sudden crashes
    fs.fsyncSync(this._fd);

    return this.sequence;
  }

  /**
   * Replays WAL log records and filters only fully committed transactions.
   * Discards trailing corrupt or uncommitted log slices gracefully.
   * @returns {Array<object>} List of operations belonging to committed transactions
   */
  recover() {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = fs.readFileSync(this.filePath, 'utf8');
    if (!content.trim()) {
      return [];
    }

    const lines = content.split('\n');
    const validEntries = [];
    let highestSeq = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const spaceIndex = line.indexOf(' ');
      if (spaceIndex === -1) {
        // Torn write at the end of the log
        break;
      }

      const storedChecksum = line.slice(0, spaceIndex);
      const jsonPayload = line.slice(spaceIndex + 1);

      const calculatedChecksum = this._computeHash(jsonPayload);
      if (storedChecksum !== calculatedChecksum) {
        // If checksum mismatch happens on the last line, it was a partial write during shutdown
        if (i === lines.length - 1 || i === lines.length - 2) {
          break;
        }
        throw new StorageCorruptionError(`Checksum mismatch in WAL entry at line ${i + 1}`);
      }

      try {
        const parsed = JSON.parse(jsonPayload);
        if (parsed.seq > highestSeq) {
          highestSeq = parsed.seq;
        }
        validEntries.push(parsed);
      } catch {
        // Corrupt JSON string
        break;
      }
    }

    this.sequence = highestSeq;

    // Filter operations by transaction commit status
    // Transactions with TX_BEGIN and TX_COMMIT are valid.
    // Operations without txId are immediate committed operations.
    const committedTxIds = new Set();
    const rollbackTxIds = new Set();

    for (const entry of validEntries) {
      if (entry.op === 'TX_COMMIT') {
        committedTxIds.add(entry.txId);
      } else if (entry.op === 'TX_ROLLBACK') {
        rollbackTxIds.add(entry.txId);
      }
    }

    const operationsToApply = validEntries.filter(entry => {
      if (['TX_BEGIN', 'TX_COMMIT', 'TX_ROLLBACK'].includes(entry.op)) {
        return false;
      }
      if (!entry.txId) {
        return true;
      }
      return committedTxIds.has(entry.txId) && !rollbackTxIds.has(entry.txId);
    });

    return operationsToApply;
  }

  /**
   * Truncates the WAL after a snapshot compaction.
   */
  truncate() {
    if (this._fd) {
      fs.closeSync(this._fd);
      this._fd = null;
    }
    fs.writeFileSync(this.filePath, '', 'utf8');
    this.sequence = 0;
    this.open();
  }

  /**
   * Closes the active file descriptor.
   */
  close() {
    if (this._fd) {
      fs.closeSync(this._fd);
      this._fd = null;
    }
  }
}
