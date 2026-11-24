/**
 * SearchEngine for Vault DB
 * Full-text, fuzzy, and semantic search over JSONB records
 * with ranking, highlighting, and facet support.
 */

class SearchEngine {
  constructor(pool) {
    this.pool = pool;
    this.indexCache = new Map();
    this.stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
  }

  async fullTextSearch(query, options = {}) {
    const { limit = 50, offset = 0, fields = ['*'] } = options;
    const terms = this.tokenize(query);
    
    if (terms.length === 0) return [];

    const sql = `
      SELECT id, data, 
        ts_rank(to_tsvector('english', data::text), plainto_tsquery('english', $1)) as rank
      FROM records
      WHERE to_tsvector('english', data::text) @@ plainto_tsquery('english', $1)
      ORDER BY rank DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.pool.query(sql, [query, limit, offset]);
    return result.rows.map(r => ({
      ...r,
      highlights: this.highlight(r.data, terms)
    }));
  }

  async fuzzySearch(query, threshold = 0.3) {
    const terms = this.tokenize(query);
    // Use pg_trgm if available, otherwise JS fallback
    const sql = `
      SELECT id, data,
        similarity(data::text, $1) as score
      FROM records
      WHERE similarity(data::text, $1) > $2
      ORDER BY score DESC
      LIMIT 30
    `;

    try {
      const result = await this.pool.query(sql, [query, threshold]);
      return result.rows;
    } catch {
      return this.jsFuzzySearch(query, threshold);
    }
  }

  async jsFuzzySearch(query, threshold) {
    const all = await this.pool.query('SELECT id, data FROM records LIMIT 500');
    return all.rows
      .map(r => ({
        ...r,
        score: this.stringSimilarity(query, JSON.stringify(r.data))
      }))
      .filter(r => r.score > threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
  }

  stringSimilarity(a, b) {
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1.0;
    return (longer.length - this.editDistance(longer, shorter)) / longer.length;
  }

  editDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) costs[j] = j;
        else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1))
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(t => t.length > 2 && !this.stopWords.has(t));
  }

  highlight(data, terms) {
    let text = JSON.stringify(data);
    for (const term of terms) {
      const re = new RegExp(`(${term})`, 'gi');
      text = text.replace(re, '**$1**');
    }
    return text.slice(0, 500);
  }

  async facetSearch(query, facetField) {
    const results = await this.fullTextSearch(query, { limit: 200 });
    const facets = {};
    for (const r of results) {
      const value = r.data[facetField];
      if (value) {
        facets[value] = (facets[value] || 0) + 1;
      }
    }
    return Object.entries(facets)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }

  async semanticSearch(embedding, limit = 20) {
    // Placeholder for vector search if pgvector is enabled
    const sql = `
      SELECT id, data,
        data <-> $1 as distance
      FROM records
      ORDER BY distance
      LIMIT $2
    `;
    try {
      return (await this.pool.query(sql, [embedding, limit])).rows;
    } catch {
      return [];
    }
  }

  async buildIndex() {
    const result = await this.pool.query('SELECT id, data FROM records');
    for (const row of result.rows) {
      const tokens = this.tokenize(JSON.stringify(row.data));
      this.indexCache.set(row.id, new Set(tokens));
    }
    return this.indexCache.size;
  }

  searchIndex(query) {
    const terms = this.tokenize(query);
    const matches = [];
    for (const [id, tokens] of this.indexCache) {
      const score = terms.filter(t => tokens.has(t)).length / terms.length;
      if (score > 0) matches.push({ id, score });
    }
    return matches.sort((a, b) => b.score - a.score);
  }

  // Additional methods
  async suggest(query, limit = 5) {
    const terms = this.tokenize(query);
    if (terms.length === 0) return [];
    const last = terms[terms.length - 1];
    // Simple prefix match from cache
    const suggestions = new Set();
    for (const tokens of this.indexCache.values()) {
      for (const t of tokens) {
        if (t.startsWith(last) && t !== last) suggestions.add(t);
      }
    }
    return Array.from(suggestions).slice(0, limit);
  }

  getStats() {
    return {
      indexedDocuments: this.indexCache.size,
      stopWords: this.stopWords.size
    };
  }

  clearCache() {
    this.indexCache.clear();
  }
}

module.exports = SearchEngine;
