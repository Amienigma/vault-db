/**
 * MigrationEngine for Vault DB
 * Handles schema evolution, data transformations, versioned migrations,
 * rollback support, and dry-run previews for JSONB-backed records.
 * 
 * @module MigrationEngine
 * @version 1.0.0
 * @date 2026-11-18
 */

class Migration {
  constructor(id, description, up, down) {
    this.id = id;
    this.description = description;
    this.up = up; // async (record) => transformedRecord
    this.down = down; // async (record) => previousRecord
    this.appliedAt = null;
  }
}

class MigrationEngine {
  constructor(store) {
    this.store = store; // expected: { getAll(), put(), delete(), query() }
    this.migrations = new Map();
    this.applied = new Set();
    this.log = [];
    this.loadApplied();
  }

  /**
   * Register a migration.
   */
  register(migration) {
    if (this.migrations.has(migration.id)) {
      throw new Error(`Migration ${migration.id} already registered`);
    }
    this.migrations.set(migration.id, migration);
  }

  /**
   * Load previously applied migration IDs from store metadata.
   */
  async loadApplied() {
    try {
      const meta = await this.store.query({ type: "migration_meta" });
      if (meta && meta.length) {
        meta.forEach((m) => this.applied.add(m.id));
      }
    } catch (e) {
      console.warn("No migration meta found, starting fresh");
    }
  }

  /**
   * List pending migrations in order.
   */
  getPending() {
    return Array.from(this.migrations.values())
      .filter((m) => !this.applied.has(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Dry-run: preview what a migration would change without writing.
   */
  async dryRun(migrationId, limit = 100) {
    const mig = this.migrations.get(migrationId);
    if (!mig) throw new Error("Migration not found");
    const records = await this.store.getAll(limit);
    const previews = [];
    for (const rec of records) {
      try {
        const after = await mig.up({ ...rec });
        if (JSON.stringify(after) !== JSON.stringify(rec)) {
          previews.push({ before: rec, after });
        }
      } catch (err) {
        previews.push({ before: rec, error: err.message });
      }
    }
    return { migrationId, affected: previews.length, previews: previews.slice(0, 20) };
  }

  /**
   * Apply all pending migrations.
   */
  async migrate(options = { dryRun: false, batchSize: 50 }) {
    const pending = this.getPending();
    const results = [];
    for (const mig of pending) {
      if (options.dryRun) {
        const preview = await this.dryRun(mig.id);
        results.push({ id: mig.id, status: "dry-run", ...preview });
        continue;
      }
      const res = await this.applyOne(mig, options.batchSize);
      results.push(res);
    }
    return results;
  }

  /**
   * Apply a single migration in batches.
   */
  async applyOne(mig, batchSize = 50) {
    const start = Date.now();
    let processed = 0;
    let errors = 0;
    let cursor = null;
    while (true) {
      const batch = await this.store.getAll(batchSize, cursor);
      if (!batch.length) break;
      for (const rec of batch) {
        try {
          const transformed = await mig.up({ ...rec });
          await this.store.put(transformed);
          processed++;
        } catch (err) {
          errors++;
          this.log.push({ migration: mig.id, recordId: rec.id, error: err.message });
        }
      }
      cursor = batch[batch.length - 1]?.id;
      if (batch.length < batchSize) break;
    }
    if (errors === 0) {
      this.applied.add(mig.id);
      await this.store.put({ type: "migration_meta", id: mig.id, appliedAt: new Date().toISOString() });
    }
    const result = {
      id: mig.id,
      status: errors === 0 ? "applied" : "partial",
      processed,
      errors,
      durationMs: Date.now() - start,
    };
    this.log.push(result);
    return result;
  }

  /**
   * Rollback the last applied migration.
   */
  async rollback(count = 1) {
    const appliedList = Array.from(this.applied).sort().reverse();
    const toRollback = appliedList.slice(0, count);
    const results = [];
    for (const id of toRollback) {
      const mig = this.migrations.get(id);
      if (!mig || !mig.down) {
        results.push({ id, status: "no-down" });
        continue;
      }
      // Simplified: re-process all with down
      const records = await this.store.getAll();
      let processed = 0;
      for (const rec of records) {
        try {
          const reverted = await mig.down({ ...rec });
          await this.store.put(reverted);
          processed++;
        } catch (err) {
          this.log.push({ rollback: id, error: err.message });
        }
      }
      this.applied.delete(id);
      await this.store.delete({ type: "migration_meta", id });
      results.push({ id, status: "rolled-back", processed });
    }
    return results;
  }

  /**
   * Example migration: add a computed field.
   */
  static createAddFieldMigration(fieldName, computeFn) {
    return new Migration(
      `add_${fieldName}_${Date.now()}`,
      `Add computed field ${fieldName}`,
      async (rec) => {
        rec[fieldName] = await computeFn(rec);
        return rec;
      },
      async (rec) => {
        delete rec[fieldName];
        return rec;
      }
    );
  }

  /**
   * Get migration status report.
   */
  status() {
    return {
      registered: this.migrations.size,
      applied: this.applied.size,
      pending: this.getPending().length,
      recentLog: this.log.slice(-10),
    };
  }
}

module.exports = { MigrationEngine, Migration };
