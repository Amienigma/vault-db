/**
 * Vault DB Analytics Engine
 * Advanced analytics, aggregation, and insight generation for stored JSONB records.
 * Supports statistical analysis, anomaly detection, and report generation.
 * 
 * @module AnalyticsEngine
 * @version 2026-11-13
 */

class AnalyticsEngine {
  constructor(store) {
    this.store = store;
    this.cache = new Map();
    this.anomalyThreshold = 2.5;
  }

  async computeStats(collection, field) {
    const cacheKey = `stats:${collection}:${field}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const records = await this.store.query(collection, {});
    const values = records.map(r => parseFloat(r[field])).filter(v => !isNaN(v));
    if (!values.length) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const stats = { count: values.length, min: sorted[0], max: sorted[sorted.length - 1], mean, median, stdDev, variance, sum };
    this.cache.set(cacheKey, stats);
    return stats;
  }

  async detectAnomalies(collection, field) {
    const stats = await this.computeStats(collection, field);
    if (!stats || stats.stdDev === 0) return [];
    const records = await this.store.query(collection, {});
    return records.filter(r => {
      const val = parseFloat(r[field]);
      if (isNaN(val)) return false;
      const z = Math.abs((val - stats.mean) / stats.stdDev);
      return z > this.anomalyThreshold;
    }).map(r => ({
      record: r,
      zScore: Math.abs((parseFloat(r[field]) - stats.mean) / stats.stdDev)
    }));
  }

  async groupBy(collection, groupField, aggField, operation = 'sum') {
    const records = await this.store.query(collection, {});
    const groups = {};
    records.forEach(r => {
      const key = r[groupField] || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(parseFloat(r[aggField]) || 0);
    });
    const result = {};
    for (const [key, values] of Object.entries(groups)) {
      switch (operation) {
        case 'sum': result[key] = values.reduce((a, b) => a + b, 0); break;
        case 'avg': result[key] = values.reduce((a, b) => a + b, 0) / values.length; break;
        case 'count': result[key] = values.length; break;
        case 'min': result[key] = Math.min(...values); break;
        case 'max': result[key] = Math.max(...values); break;
      }
    }
    return result;
  }

  async timeSeries(collection, timeField, valueField, interval = 'day') {
    const records = await this.store.query(collection, {});
    const buckets = {};
    records.forEach(r => {
      const date = new Date(r[timeField]);
      if (isNaN(date.getTime())) return;
      let key;
      if (interval === 'day') key = date.toISOString().slice(0, 10);
      else if (interval === 'hour') key = date.toISOString().slice(0, 13);
      else if (interval === 'month') key = date.toISOString().slice(0, 7);
      else key = date.toISOString().slice(0, 10);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(parseFloat(r[valueField]) || 0);
    });
    return Object.entries(buckets).map(([time, values]) => ({
      time,
      sum: values.reduce((a, b) => a + b, 0),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length
    })).sort((a, b) => a.time.localeCompare(b.time));
  }

  async correlation(collection, fieldA, fieldB) {
    const records = await this.store.query(collection, {});
    const pairs = records.map(r => [parseFloat(r[fieldA]), parseFloat(r[fieldB])]).filter(([a, b]) => !isNaN(a) && !isNaN(b));
    if (pairs.length < 2) return 0;
    const meanA = pairs.reduce((s, [a]) => s + a, 0) / pairs.length;
    const meanB = pairs.reduce((s, [, b]) => s + b, 0) / pairs.length;
    let num = 0, denA = 0, denB = 0;
    pairs.forEach(([a, b]) => {
      const da = a - meanA;
      const db = b - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    });
    return num / Math.sqrt(denA * denB) || 0;
  }

  async generateInsights(collection, fields = []) {
    const insights = [];
    for (const field of fields) {
      const stats = await this.computeStats(collection, field);
      if (stats) {
        insights.push({
          field,
          type: 'stats',
          message: `${field}: mean=${stats.mean.toFixed(2)}, std=${stats.stdDev.toFixed(2)}, range=[${stats.min}, ${stats.max}]`
        });
        const anomalies = await this.detectAnomalies(collection, field);
        if (anomalies.length) {
          insights.push({
            field,
            type: 'anomaly',
            message: `Found ${anomalies.length} anomalies in ${field}`,
            details: anomalies.slice(0, 5)
          });
        }
      }
    }
    return insights;
  }

  clearCache() {
    this.cache.clear();
  }

  async exportSnapshot(collection) {
    const records = await this.store.query(collection, {});
    return {
      collection,
      recordCount: records.length,
      timestamp: new Date().toISOString(),
      sample: records.slice(0, 10)
    };
  }
}

function percentile(sorted, p) {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

function movingAverage(values, window = 5) {
  const result = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return result;
}

module.exports = { AnalyticsEngine, percentile, movingAverage };
