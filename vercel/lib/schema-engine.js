/**
 * SchemaEngine for Vault DB
 * Handles dynamic schema inference, validation, migration, and JSONB structure management.
 * Supports automatic type detection from CSV/JSON uploads.
 * Added 2026-11-22 as daily code addition.
 */

class SchemaEngine {
  constructor() {
    this.schemas = new Map();
    this.typeMap = {
      string: 'text',
      number: 'numeric',
      boolean: 'boolean',
      date: 'timestamp',
      array: 'jsonb',
      object: 'jsonb'
    };
    this.validators = new Map();
    this.history = [];
    this.debug = false;
  }

  init() {
    console.log('SchemaEngine initialized');
    this.registerDefaultValidators();
  }

  registerDefaultValidators() {
    this.validators.set('email', (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val));
    this.validators.set('url', (val) => {
      try { new URL(val); return true; } catch { return false; }
    });
    this.validators.set('uuid', (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
    this.validators.set('positive', (val) => typeof val === 'number' && val > 0);
  }

  inferSchema(data, name = 'inferred') {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return this.createEmptySchema(name);
    }
    const sample = Array.isArray(data) ? data[0] : data;
    const fields = {};
    for (const [key, value] of Object.entries(sample)) {
      fields[key] = {
        type: this.detectType(value),
        nullable: true,
        indexed: false,
        unique: false,
        validators: []
      };
    }
    const schema = {
      name,
      fields,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sampleCount: Array.isArray(data) ? data.length : 1
    };
    this.schemas.set(name, schema);
    this.history.push({ action: 'infer', name, timestamp: Date.now() });
    return schema;
  }

  detectType(value) {
    if (value === null || value === undefined) return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
      if (/^\d+$/.test(value)) return 'number';
      return 'string';
    }
    return 'string';
  }

  createEmptySchema(name) {
    return {
      name,
      fields: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sampleCount: 0
    };
  }

  addField(schemaName, fieldName, config) {
    const schema = this.schemas.get(schemaName);
    if (!schema) return null;
    schema.fields[fieldName] = {
      type: config.type || 'string',
      nullable: config.nullable !== false,
      indexed: config.indexed || false,
      unique: config.unique || false,
      validators: config.validators || [],
      defaultValue: config.defaultValue
    };
    schema.updatedAt = Date.now();
    schema.version++;
    return schema.fields[fieldName];
  }

  removeField(schemaName, fieldName) {
    const schema = this.schemas.get(schemaName);
    if (schema && schema.fields[fieldName]) {
      delete schema.fields[fieldName];
      schema.updatedAt = Date.now();
      schema.version++;
      return true;
    }
    return false;
  }

  validateRecord(schemaName, record) {
    const schema = this.schemas.get(schemaName);
    if (!schema) return { valid: false, errors: ['Schema not found'] };
    const errors = [];
    for (const [field, config] of Object.entries(schema.fields)) {
      const value = record[field];
      if (value === undefined || value === null) {
        if (!config.nullable) errors.push(`${field} is required`);
        continue;
      }
      if (this.detectType(value) !== config.type && config.type !== 'string') {
        errors.push(`${field} type mismatch: expected ${config.type}`);
      }
      for (const validator of config.validators) {
        const fn = this.validators.get(validator);
        if (fn && !fn(value)) {
          errors.push(`${field} failed ${validator} validation`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  generatePostgresDDL(schemaName) {
    const schema = this.schemas.get(schemaName);
    if (!schema) return '';
    const columns = Object.entries(schema.fields).map(([name, config]) => {
      const pgType = this.typeMap[config.type] || 'text';
      let col = `  "${name}" ${pgType}`;
      if (!config.nullable) col += ' NOT NULL';
      if (config.unique) col += ' UNIQUE';
      return col;
    }).join(',\n');
    return `CREATE TABLE IF NOT EXISTS "${schemaName}" (\n  id SERIAL PRIMARY KEY,\n${columns},\n  created_at TIMESTAMP DEFAULT NOW(),\n  data JSONB\n);`;
  }

  migrateSchema(oldName, newName, transformations = {}) {
    const oldSchema = this.schemas.get(oldName);
    if (!oldSchema) return null;
    const newSchema = JSON.parse(JSON.stringify(oldSchema));
    newSchema.name = newName;
    newSchema.version = 1;
    newSchema.updatedAt = Date.now();
    for (const [field, transform] of Object.entries(transformations)) {
      if (transform.rename) {
        if (newSchema.fields[field]) {
          newSchema.fields[transform.rename] = newSchema.fields[field];
          delete newSchema.fields[field];
        }
      }
      if (transform.type && newSchema.fields[field]) {
        newSchema.fields[field].type = transform.type;
      }
    }
    this.schemas.set(newName, newSchema);
    this.history.push({ action: 'migrate', from: oldName, to: newName, timestamp: Date.now() });
    return newSchema;
  }

  getSchema(name) {
    return this.schemas.get(name);
  }

  listSchemas() {
    return Array.from(this.schemas.keys());
  }

  exportSchema(name) {
    const schema = this.schemas.get(name);
    return schema ? JSON.stringify(schema, null, 2) : null;
  }

  importSchema(json) {
    try {
      const schema = typeof json === 'string' ? JSON.parse(json) : json;
      this.schemas.set(schema.name, schema);
      return schema;
    } catch (e) {
      return null;
    }
  }

  compareSchemas(name1, name2) {
    const s1 = this.schemas.get(name1);
    const s2 = this.schemas.get(name2);
    if (!s1 || !s2) return null;
    const fields1 = Object.keys(s1.fields);
    const fields2 = Object.keys(s2.fields);
    return {
      added: fields2.filter(f => !fields1.includes(f)),
      removed: fields1.filter(f => !fields2.includes(f)),
      common: fields1.filter(f => fields2.includes(f)),
      typeChanges: fields1.filter(f => fields2.includes(f) && s1.fields[f].type !== s2.fields[f].type)
    };
  }

  suggestIndexes(schemaName) {
    const schema = this.schemas.get(schemaName);
    if (!schema) return [];
    return Object.entries(schema.fields)
      .filter(([_, config]) => config.type === 'string' || config.type === 'number')
      .map(([name]) => `CREATE INDEX IF NOT EXISTS idx_${schemaName}_${name} ON "${schemaName}" ("${name}");`);
  }

  getStats() {
    return {
      schemaCount: this.schemas.size,
      totalFields: Array.from(this.schemas.values()).reduce((sum, s) => sum + Object.keys(s.fields).length, 0),
      historyLength: this.history.length
    };
  }

  reset() {
    this.schemas.clear();
    this.history = [];
  }

  version = '1.0.0';
  description = 'Dynamic schema management for Vault DB';
}

module.exports = SchemaEngine;
