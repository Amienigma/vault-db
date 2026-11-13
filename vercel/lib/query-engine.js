// Vault DB - Advanced Query Engine
// Daily code addition module for filtering, aggregation, validation, and export
// ~500+ lines of functional query processing for CSV/JSON vault data

class QueryEngine {
  constructor(records = []) {
    this.records = records;
    this.filters = [];
    this.sorts = [];
    this.aggregations = [];
  }

  load(records) {
    this.records = Array.isArray(records) ? records : [];
    return this;
  }

  filter(predicate) {
    this.filters.push(predicate);
    return this;
  }

  where(field, operator, value) {
    const ops = {
      eq: (a, b) => a === b,
      ne: (a, b) => a !== b,
      gt: (a, b) => a > b,
      lt: (a, b) => a < b,
      gte: (a, b) => a >= b,
      lte: (a, b) => a <= b,
      contains: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
      startsWith: (a, b) => String(a).toLowerCase().startsWith(String(b).toLowerCase()),
      in: (a, b) => Array.isArray(b) && b.includes(a)
    };
    const opFn = ops[operator] || ops.eq;
    this.filters.push(record => opFn(record[field], value));
    return this;
  }

  sortBy(field, direction = 'asc') {
    this.sorts.push({ field, direction });
    return this;
  }

  aggregate(type, field, alias) {
    this.aggregations.push({ type, field, alias });
    return this;
  }

  execute() {
    let result = [...this.records];

    // Apply filters
    this.filters.forEach(filter => {
      result = result.filter(filter);
    });

    // Apply sorts
    this.sorts.forEach(({ field, direction }) => {
      result.sort((a, b) => {
        const va = a[field];
        const vb = b[field];
        if (va < vb) return direction === 'asc' ? -1 : 1;
        if (va > vb) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    });

    // Apply aggregations if any
    if (this.aggregations.length > 0) {
      const aggResult = {};
      this.aggregations.forEach(({ type, field, alias }) => {
        const values = result.map(r => r[field]).filter(v => v != null);
        switch (type) {
          case 'count':
            aggResult[alias || 'count'] = values.length;
            break;
          case 'sum':
            aggResult[alias || 'sum'] = values.reduce((a, b) => a + Number(b), 0);
            break;
          case 'avg':
            aggResult[alias || 'avg'] = values.length ? values.reduce((a, b) => a + Number(b), 0) / values.length : 0;
            break;
          case 'min':
            aggResult[alias || 'min'] = Math.min(...values.map(Number));
            break;
          case 'max':
            aggResult[alias || 'max'] = Math.max(...values.map(Number));
            break;
          case 'unique':
            aggResult[alias || 'unique'] = [...new Set(values)].length;
            break;
        }
      });
      return { data: result, aggregates: aggResult };
    }

    return { data: result };
  }

  reset() {
    this.filters = [];
    this.sorts = [];
    this.aggregations = [];
    return this;
  }
}

class Validator {
  static rules = {
    required: (value) => value != null && value !== '',
    number: (value) => !isNaN(Number(value)),
    email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)),
    date: (value) => !isNaN(Date.parse(value)),
    length: (value, min, max) => {
      const len = String(value).length;
      return len >= (min || 0) && len <= (max || Infinity);
    }
  };

  static validate(record, schema) {
    const errors = [];
    for (const [field, rule] of Object.entries(schema)) {
      const value = record[field];
      if (typeof rule === 'string') {
        if (!this.rules[rule](value)) {
          errors.push({ field, rule, value });
        }
      } else if (typeof rule === 'object') {
        if (rule.required && !this.rules.required(value)) {
          errors.push({ field, rule: 'required', value });
        }
        if (rule.type && !this.rules[rule.type](value)) {
          errors.push({ field, rule: rule.type, value });
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  static validateBatch(records, schema) {
    return records.map(record => ({
      record,
      ...this.validate(record, schema)
    }));
  }
}

class Exporter {
  static toCSV(data, headers) {
    if (!data.length) return '';
    const keys = headers || Object.keys(data[0]);
    const rows = [keys.join(',')];
    data.forEach(row => {
      const values = keys.map(k => {
        const v = row[k];
        const str = v == null ? '' : String(v);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      });
      rows.push(values.join(','));
    });
    return rows.join('\n');
  }

  static toJSON(data, pretty = false) {
    return JSON.stringify(data, null, pretty ? 2 : 0);
  }

  static toMarkdownTable(data, headers) {
    if (!data.length) return '';
    const keys = headers || Object.keys(data[0]);
    const header = `| ${keys.join(' | ')} |`;
    const separator = `| ${keys.map(() => '---').join(' | ')} |`;
    const rows = data.map(row => `| ${keys.map(k => row[k] ?? '').join(' | ')} |`);
    return [header, separator, ...rows].join('\n');
  }
}

class StatsCalculator {
  static basic(values) {
    const nums = values.filter(v => typeof v === 'number' || !isNaN(Number(v))).map(Number);
    if (!nums.length) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const sorted = [...nums].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length;
    const stdDev = Math.sqrt(variance);
    return { count: nums.length, sum, mean, median, min: sorted[0], max: sorted[sorted.length - 1], stdDev, variance };
  }

  static groupBy(records, field) {
    const groups = {};
    records.forEach(record => {
      const key = record[field] ?? 'null';
      if (!groups[key]) groups[key] = [];
      groups[key].push(record);
    });
    return groups;
  }

  static histogram(values, bins = 10) {
    const nums = values.map(Number).filter(n => !isNaN(n));
    if (!nums.length) return [];
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const width = (max - min) / bins || 1;
    const histogram = Array(bins).fill(0);
    nums.forEach(n => {
      const bin = Math.min(Math.floor((n - min) / width), bins - 1);
      histogram[bin]++;
    });
    return histogram.map((count, i) => ({
      range: [min + i * width, min + (i + 1) * width],
      count
    }));
  }
}

class DataCleaner {
  static trim(records) {
    return records.map(record => {
      const cleaned = {};
      for (const [k, v] of Object.entries(record)) {
        cleaned[k] = typeof v === 'string' ? v.trim() : v;
      }
      return cleaned;
    });
  }

  static removeEmpty(records) {
    return records.filter(record => 
      Object.values(record).some(v => v != null && v !== '')
    );
  }

  static normalizeKeys(records) {
    return records.map(record => {
      const normalized = {};
      for (const [k, v] of Object.entries(record)) {
        const key = k.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        normalized[key] = v;
      }
      return normalized;
    });
  }

  static fillMissing(records, field, value) {
    return records.map(record => ({
      ...record,
      [field]: record[field] ?? value
    }));
  }
}

class QueryBuilder {
  static fromRecords(records) {
    return new QueryEngine(records);
  }

  static parseQueryString(queryString) {
    // Simple parser for basic queries like "field=value&sort=field:asc"
    const params = new URLSearchParams(queryString);
    const engine = new QueryEngine();
    // In real use, load records first
    for (const [key, value] of params) {
      if (key.startsWith('filter_')) {
        const field = key.replace('filter_', '');
        engine.where(field, 'eq', value);
      } else if (key === 'sort') {
        const [field, dir] = value.split(':');
        engine.sortBy(field, dir || 'asc');
      }
    }
    return engine;
  }
}

// Additional advanced features

class IndexBuilder {
  constructor() {
    this.indexes = new Map();
  }

  build(records, field) {
    const index = new Map();
    records.forEach((record, i) => {
      const key = record[field];
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(i);
    });
    this.indexes.set(field, index);
    return this;
  }

  lookup(field, value) {
    const index = this.indexes.get(field);
    return index ? index.get(value) || [] : [];
  }
}

class DiffEngine {
  static diff(oldRecords, newRecords, keyField = 'id') {
    const oldMap = new Map(oldRecords.map(r => [r[keyField], r]));
    const newMap = new Map(newRecords.map(r => [r[keyField], r]));
    const added = [];
    const removed = [];
    const modified = [];

    for (const [key, record] of newMap) {
      if (!oldMap.has(key)) {
        added.push(record);
      } else if (JSON.stringify(oldMap.get(key)) !== JSON.stringify(record)) {
        modified.push({ old: oldMap.get(key), new: record });
      }
    }
    for (const [key, record] of oldMap) {
      if (!newMap.has(key)) removed.push(record);
    }
    return { added, removed, modified };
  }
}

// Export everything
const VaultQueryTools = {
  QueryEngine,
  Validator,
  Exporter,
  StatsCalculator,
  DataCleaner,
  QueryBuilder,
  IndexBuilder,
  DiffEngine
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VaultQueryTools;
}

export default VaultQueryTools;
export {
  QueryEngine,
  Validator,
  Exporter,
  StatsCalculator,
  DataCleaner,
  QueryBuilder,
  IndexBuilder,
  DiffEngine
};
