/**
 * BackupEngine - Automated backups, snapshots, and recovery for Vault DB
 */

class BackupEngine {
  constructor(store, options = {}) {
    this.store = store;
    this.backups = new Map();
    this.maxBackups = options.maxBackups || 50;
    this.retentionDays = options.retentionDays || 30;
    this.autoInterval = options.autoInterval || null;
    if (this.autoInterval) this.startAutoBackup();
  }

  async createSnapshot(label = 'manual') {
    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const data = await this.store.exportAll();
    const snapshot = {
      id,
      label,
      timestamp: new Date().toISOString(),
      size: JSON.stringify(data).length,
      recordCount: Array.isArray(data) ? data.length : Object.keys(data).length,
      data
    };
    this.backups.set(id, snapshot);
    this.pruneOld();
    console.log(`[BackupEngine] Snapshot ${id} created: ${snapshot.recordCount} records`);
    return snapshot;
  }

  async restore(snapshotId) {
    const snap = this.backups.get(snapshotId);
    if (!snap) throw new Error(`Snapshot ${snapshotId} not found`);
    await this.store.clear();
    if (Array.isArray(snap.data)) {
      for (const record of snap.data) {
        await this.store.insert(record);
      }
    } else {
      await this.store.importAll(snap.data);
    }
    console.log(`[BackupEngine] Restored from ${snapshotId}`);
    return { restored: true, records: snap.recordCount };
  }

  listSnapshots() {
    return Array.from(this.backups.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map(({ data, ...meta }) => meta);
  }

  deleteSnapshot(id) {
    const deleted = this.backups.delete(id);
    if (deleted) console.log(`[BackupEngine] Deleted snapshot ${id}`);
    return deleted;
  }

  pruneOld() {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const toDelete = [];
    this.backups.forEach((snap, id) => {
      if (new Date(snap.timestamp).getTime() < cutoff) toDelete.push(id);
    });
    // Also enforce max count
    if (this.backups.size > this.maxBackups) {
      const sorted = Array.from(this.backups.entries())
        .sort((a, b) => new Date(a[1].timestamp) - new Date(b[1].timestamp));
      sorted.slice(0, this.backups.size - this.maxBackups).forEach(([id]) => toDelete.push(id));
    }
    toDelete.forEach(id => this.backups.delete(id));
    if (toDelete.length) console.log(`[BackupEngine] Pruned ${toDelete.length} old snapshots`);
  }

  startAutoBackup() {
    this.autoTimer = setInterval(async () => {
      try {
        await this.createSnapshot('auto');
      } catch (err) {
        console.error('[BackupEngine] Auto backup failed:', err);
      }
    }, this.autoInterval);
  }

  stopAutoBackup() {
    if (this.autoTimer) clearInterval(this.autoTimer);
  }

  async exportSnapshot(id) {
    const snap = this.backups.get(id);
    if (!snap) throw new Error('Snapshot not found');
    return {
      meta: { id: snap.id, label: snap.label, timestamp: snap.timestamp },
      data: snap.data
    };
  }

  async importSnapshot(exported) {
    const id = exported.meta.id || `imported_${Date.now()}`;
    this.backups.set(id, {
      id,
      label: exported.meta.label || 'imported',
      timestamp: exported.meta.timestamp || new Date().toISOString(),
      size: JSON.stringify(exported.data).length,
      recordCount: Array.isArray(exported.data) ? exported.data.length : 0,
      data: exported.data
    });
    return id;
  }

  getStats() {
    let totalSize = 0;
    let totalRecords = 0;
    this.backups.forEach(s => {
      totalSize += s.size;
      totalRecords += s.recordCount;
    });
    return {
      count: this.backups.size,
      totalSize,
      avgSize: this.backups.size ? totalSize / this.backups.size : 0,
      totalRecords
    };
  }

  async verifyIntegrity(snapshotId) {
    const snap = this.backups.get(snapshotId);
    if (!snap) return { valid: false, error: 'Not found' };
    try {
      const parsed = typeof snap.data === 'string' ? JSON.parse(snap.data) : snap.data;
      return { valid: true, recordCount: Array.isArray(parsed) ? parsed.length : 'object' };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }
}

module.exports = BackupEngine;
