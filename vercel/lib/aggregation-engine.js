/**
 * AggregationEngine for Vault DB
 * Group-by, sum, average, count, min/max, histograms,
 * and advanced aggregations on stored JSONB records.
 * Production-ready for query and analytics workflows.
 */

class AggregationEngine {
  constructor() {
    this.results = new Map();
    this.cache = new Map();
  }

  groupBy(records, key, aggregations = {}) {
    const groups = new Map();
    for (const record of records) {
      const groupKey = this.extractKey(record, key);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(record);
    }

    const result = [];
    for (const [gk, items] of groups) {
      const agg = { group: gk, count: items.length };
      for (const [field, op] of Object.entries(aggregations)) {
        agg[`${op}_${field}`] = this.computeAgg(items, field, op);
      }
      result.push(agg);
    }
    this.results.set(`groupby:${key}`, result);
    return result;
  }

  extractKey(record, key) {
    if (typeof key === 'function') return key(record);
    return record[key] ?? record.data?.[key] ?? 'unknown';
  }

  computeAgg(items, field, op) {
    const values = items.map(i => this.extractValue(i, field)).filter(v => v != null);
    if (values.length === 0) return null;
    switch (op) {
      case 'sum': return values.reduce((a, b) => a + Number(b), 0);
      case 'avg': return values.reduce((a, b) => a + Number(b), 0) / values.length;
      case 'min': return Math.min(...values.map(Number));
      case 'max': return Math.max(...values.map(Number));
      case 'count': return values.length;
      case 'distinct': return new Set(values).size;
      default: return null;
    }
  }

  extractValue(record, field) {
    return record[field] ?? record.data?.[field];
  }

  histogram(records, field, buckets = 10) {
    const values = records.map(r => Number(this.extractValue(r, field))).filter(v => !isNaN(v));
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const binSize = range / buckets;
    const bins = Array.from({ length: buckets }, (_, i) => ({
      range: [min + i * binSize, min + (i + 1) * binSize],
      count: 0
    }));

    for (const v of values) {
      const idx = Math.min(buckets - 1, Math.floor((v - min) / binSize));
      bins[idx].count++;
    }
    this.results.set(`hist:${field}`, bins);
    return bins;
  }

  timeSeries(records, dateField, valueField, interval = 'day') {
    const series = new Map();
    for (const r of records) {
      const date = new Date(this.extractValue(r, dateField));
      if (isNaN(date.getTime())) continue;
      const key = this.bucketDate(date, interval);
      if (!series.has(key)) series.set(key, []);
      series.get(key).push(Number(this.extractValue(r, valueField)) || 0);
    }
    return Array.from(series.entries()).map(([k, vals]) => ({
      bucket: k,
      sum: vals.reduce((a, b) => a + b, 0),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      count: vals.length
    })).sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  bucketDate(date, interval) {
    const d = new Date(date);
    if (interval === 'hour') return d.toISOString().slice(0, 13);
    if (interval === 'day') return d.toISOString().slice(0, 10);
    if (interval === 'week') {
      const week = Math.floor(d.getDate() / 7);
      return `${d.getFullYear()}-W${week}`;
    }
    if (interval === 'month') return d.toISOString().slice(0, 7);
    return d.toISOString().slice(0, 10);
  }

  topN(records, field, n = 10, agg = 'count') {
    const groups = this.groupBy(records, field, { [field]: agg });
    return groups.sort((a, b) => (b[`${agg}_${field}`] || 0) - (a[`${agg}_${field}`] || 0)).slice(0, n);
  }

  percentile(records, field, p = 0.5) {
    const values = records.map(r => Number(this.extractValue(r, field))).filter(v => !isNaN(v)).sort((a, b) => a - b);
    if (values.length === 0) return null;
    const idx = Math.floor(p * (values.length - 1));
    return values[idx];
  }

  correlation(records, fieldA, fieldB) {
    const pairs = records.map(r => [Number(this.extractValue(r, fieldA)), Number(this.extractValue(r, fieldB))]).filter(([a, b]) => !isNaN(a) && !isNaN(b));
    if (pairs.length < 2) return 0;
    const n = pairs.length;
    const sumA = pairs.reduce((s, [a]) => s + a, 0);
    const sumB = pairs.reduce((s, [, b]) => s + b, 0);
    const sumAB = pairs.reduce((s, [a, b]) => s + a * b, 0);
    const sumA2 = pairs.reduce((s, [a]) => s + a * a, 0);
    const sumB2 = pairs.reduce((s, [, b]) => s + b * b, 0);
    const num = n * sumAB - sumA * sumB;
    const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
    return den === 0 ? 0 : num / den;
  }

  // Advanced
  pivot(records, rowKey, colKey, valueField, op = 'sum') {
    const pivot = new Map();
    for (const r of records) {
      const row = this.extractKey(r, rowKey);
      const col = this.extractKey(r, colKey);
      const val = Number(this.extractValue(r, valueField)) || 0;
      if (!pivot.has(row)) pivot.set(row, new Map());
      const rowMap = pivot.get(row);
      rowMap.set(col, (rowMap.get(col) || 0) + (op === 'sum' ? val : 1));
    }
    return Array.from(pivot.entries()).map(([row, cols]) => ({
      row,
      ...Object.fromEntries(cols)
    }));
  }

  runningTotal(records, field, sortField) {
    const sorted = [...records].sort((a, b) => {
      const va = this.extractValue(a, sortField);
      const vb = this.extractValue(b, sortField);
      return va > vb ? 1 : -1;
    });
    let total = 0;
    return sorted.map(r => {
      total += Number(this.extractValue(r, field)) || 0;
      return { ...r, runningTotal: total };
    });
  }

  movingAverage(records, field, window = 5) {
    const values = records.map(r => Number(this.extractValue(r, field)) || 0);
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = values.slice(start, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      result.push({ index: i, value: values[i], movingAvg: avg });
    }
    return result;
  }

  // Cache and utils
  clearCache() {
    this.cache.clear();
  }

  getCached(key) {
    return this.cache.get(key);
  }

  setCached(key, value) {
    this.cache.set(key, value);
    return value;
  }

  listResults() {
    return Array.from(this.results.keys());
  }

  // End of AggregationEngine
}

export function createAggregationEngine() {
  return new AggregationEngine();
}

export default AggregationEngine;
