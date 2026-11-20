/**
 * SyncEngine for Vault DB
 * Handles bi-directional sync between local store, Postgres JSONB,
 * and external sources. Conflict resolution, incremental updates,
 * and change tracking.
 * 
 * @module SyncEngine
 * @version 1.0.0
 * @date 2026-11-19
 */

class SyncEngine {
  constructor(store, options = {}) {
    this.store = store;
    this.options = {
      batchSize: 100,
      conflictStrategy: 'last-write-wins',
      ...options,
    };
    this.changelog = [];
    this.peers = new Map();
    this.lastSync = null;
  }

  registerPeer(id, adapter) {
    this.peers.set(id, adapter);
    return this;
  }

  async sync(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not registered`);
    const localChanges = this.getLocalChanges();
    const remoteChanges = await peer.getChangesSince(this.lastSync);
    const merged = this.resolveConflicts(localChanges, remoteChanges);
    await this.applyChanges(merged.local);
    await peer.applyChanges(merged.remote);
    this.lastSync = new Date().toISOString();
    this.changelog.push({ peer: peerId, time: this.lastSync, changes: merged.total });
    return { synced: merged.total, conflicts: merged.conflicts };
  }

  getLocalChanges() {
    // Placeholder: in real impl, query store for modified records
    return this.store.query ? this.store.query({ modifiedSince: this.lastSync }) : [];
  }

  resolveConflicts(local, remote) {
    const conflicts = [];
    const localMap = new Map(local.map(r => [r.id, r]));
    const remoteMap = new Map(remote.map(r => [r.id, r]));
    const toApplyLocal = [];
    const toApplyRemote = [];

    for (const [id, r] of remoteMap) {
      if (localMap.has(id)) {
        const l = localMap.get(id);
        if (this.options.conflictStrategy === 'last-write-wins') {
          if (new Date(r.updated) > new Date(l.updated)) {
            toApplyLocal.push(r);
          } else {
            toApplyRemote.push(l);
          }
        } else {
          conflicts.push({ id, local: l, remote: r });
        }
      } else {
        toApplyLocal.push(r);
      }
    }

    for (const [id, l] of localMap) {
      if (!remoteMap.has(id)) {
        toApplyRemote.push(l);
      }
    }

    return {
      local: toApplyLocal,
      remote: toApplyRemote,
      conflicts,
      total: toApplyLocal.length + toApplyRemote.length,
    };
  }

  async applyChanges(changes) {
    for (const change of changes) {
      if (this.store.upsert) {
        await this.store.upsert(change);
      }
    }
  }

  async fullSync() {
    const results = [];
    for (const [id] of this.peers) {
      results.push(await this.sync(id));
    }
    return results;
  }

  getStatus() {
    return {
      peers: Array.from(this.peers.keys()),
      lastSync: this.lastSync,
      pendingChanges: this.changelog.length,
      strategy: this.options.conflictStrategy,
    };
  }

  exportChangelog() {
    return JSON.stringify(this.changelog.slice(-50), null, 2);
  }
}

module.exports = SyncEngine;
