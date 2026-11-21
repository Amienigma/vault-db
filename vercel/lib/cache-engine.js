/**
 * CacheEngine for Vault DB
 * In-memory and optional persistent caching for query results,
 * with TTL, invalidation, and stats tracking.
 *
 * @module CacheEngine
 * @version 1.0.0
 * @date 2026-11-20
 */

class CacheEngine {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default
    this.maxSize = options.maxSize || 1000;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  set(key, value, customTtl) {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    const expires = Date.now() + (customTtl || this.ttl);
    this.cache.set(key, { value, expires, created: Date.now() });
    return true;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    let count = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.created < oldestTime) {
        oldestTime = entry.created;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? (this.hits / total).toFixed(3) : 0,
      evictions: this.evictions,
      maxSize: this.maxSize,
      ttl: this.ttl,
    };
  }

  // Additional methods
  touch(key) {
    const entry = this.cache.get(key);
    if (entry) {
      entry.expires = Date.now() + this.ttl;
      return true;
    }
    return false;
  }

  keys() {
    return Array.from(this.cache.keys());
  }

  size() {
    return this.cache.size;
  }

  export() {
    const data = {};
    for (const [key, entry] of this.cache) {
      if (Date.now() <= entry.expires) {
        data[key] = entry.value;
      }
    }
    return data;
  }

  import(data, ttl) {
    Object.entries(data).forEach(([k, v]) => this.set(k, v, ttl));
  }
}

module.exports = CacheEngine;
