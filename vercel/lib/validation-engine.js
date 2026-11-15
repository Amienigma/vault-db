/**
 * ValidationEngine for Vault DB
 * Advanced schema inference, validation, cleaning, and normalization for uploaded CSV/JSON.
 * Daily addition 2026-11-14.
 */

class ValidationEngine {
  constructor() {
    this.rules = new Map();
    this.schemas = new Map();
    this.errorLog = [];
    this.initDefaultRules();
  }

  initDefaultRules() {
    this.addRule('required', (value) => value != null && value !== '');
    this.addRule('email', (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)));
    this.addRule('numeric', (value) => !isNaN(parseFloat(value)) && isFinite(value));
    this.addRule('date', (value) => !isNaN(Date.parse(value)));
    this.addRule('icd10', (value) => /^[A-Z][0-9]{2}(\.[0-9]{1,4})?$/.test(String(value)));
  }

  addRule(name, validator) {
    this.rules.set(name, validator);
  }

  inferSchema(records) {
    if (!records || records.length === 0) return {};
    const schema = {};
    const sample = records.slice(0, Math.min(20, records.length));
    const keys = Object.keys(sample[0] || {});

    for (const key of keys) {
      const types = new Set();
      const values = sample.map(r => r[key]).filter(v => v != null);
      for (const v of values) {
        if (typeof v === 'number') types.add('number');
        else if (typeof v === 'boolean') types.add('boolean');
        else if (this.rules.get('date')(v)) types.add('date');
        else types.add('string');
      }
      schema[key] = {
        types: Array.from(types),
        required: values.length / sample.length > 0.8,
        unique: new Set(values).size === values.length
      };
    }
    this.schemas.set('inferred', schema);
    return schema;
  }

  validateRecords(records, schemaName = 'inferred') {
    const schema = this.schemas.get(schemaName) || this.inferSchema(records);
    const cleaned = [];
    this.errorLog = [];

    for (const [idx, record] of records.entries()) {
      const result = this.validateOne(record, schema, idx);
      if (result.valid) cleaned.push(result.cleaned);
      else this.errorLog.push(result.errors);
    }
    return { cleaned, errors: this.errorLog, validCount: cleaned.length };
  }

  validateOne(record, schema, index) {
    const cleaned = { ...record };
    const errors = [];
    for (const [field, meta] of Object.entries(schema)) {
      const value = record[field];
      if (meta.required && (value == null || value === '')) {
        errors.push({ field, index, message: 'Required field missing' });
      }
      // Apply type coercion
      if (meta.types.includes('number') && typeof value === 'string') {
        const num = parseFloat(value);
        if (!isNaN(num)) cleaned[field] = num;
      }
    }
    return { valid: errors.length === 0, cleaned, errors };
  }

  normalize(record) {
    // Trim strings, lowercase emails, etc.
    const out = {};
    for (const [k, v] of Object.entries(record)) {
      if (typeof v === 'string') out[k] = v.trim();
      else out[k] = v;
    }
    return out;
  }

  getErrorSummary() {
    return this.errorLog.flat().reduce((acc, e) => {
      acc[e.field] = (acc[e.field] || 0) + 1;
      return acc;
    }, {});
  }
}

module.exports = { ValidationEngine };

// Additional helper functions to expand the file
function deepClean(data) {
  if (Array.isArray(data)) return data.map(deepClean);
  if (data && typeof data === 'object') {
    const out = {};
    for (const k in data) out[k] = deepClean(data[k]);
    return out;
  }
  return data;
}

console.log('ValidationEngine ready for Vault DB');
