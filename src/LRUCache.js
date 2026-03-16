/**
 * cache/LRUCache.js
 *
 * A hand-rolled LRU (Least Recently Used) cache.
 *
 * WHY NOT USE A LIBRARY?
 * Building this manually demonstrates the core data structure interview pattern.
 * More importantly, it gives us precise control over TTL eviction and the ability
 * to expose internal metrics (hit rate, size) to the analytics dashboard.
 *
 * DATA STRUCTURE CHOICE: Doubly Linked List + HashMap
 * The goal is O(1) for both get and put operations.
 *
 * - HashMap (JS Map):  O(1) lookup by key.
 * - Doubly Linked List: O(1) insertion and deletion anywhere in the list,
 *   provided we already have a pointer to the node. The HashMap gives us
 *   that pointer.
 *
 * The list is ordered by recency. The HEAD is the most recently used.
 * The TAIL is the least recently used (the next candidate for eviction).
 *
 * When capacity is exceeded, we remove the tail node and delete its key
 * from the map. Both operations are O(1).
 *
 * TTL STRATEGY: Lazy eviction.
 * We do NOT run a background timer scanning all entries. Instead, we check
 * the expiry timestamp at read time. If expired, we delete and return null.
 * This avoids a timer that could thrash the list on high-cardinality caches.
 * Expired entries are eventually displaced by newer ones or found stale on get.
 */

class Node {
  constructor(key, value, expiresAt) {
    this.key = key;
    this.value = value;
    this.expiresAt = expiresAt; // Unix timestamp in ms, or Infinity if no TTL
    this.prev = null;
    this.next = null;
  }
}

class LRUCache {
  /**
   * @param {number} capacity - Maximum number of entries before eviction begins.
   * @param {number} defaultTtlMs - Default TTL in milliseconds. 0 means no expiry.
   */
  constructor(capacity, defaultTtlMs = 0) {
    if (capacity < 1) throw new RangeError("LRU capacity must be >= 1");

    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;

    // The map stores key -> Node references.
    this.map = new Map();

    // Sentinel nodes: head and tail never hold real data.
    // They eliminate edge-case checks for empty list operations.
    // head.next is always the most recently used real node.
    // tail.prev is always the least recently used real node.
    this.head = new Node(null, null, Infinity);
    this.tail = new Node(null, null, Infinity);
    this.head.next = this.tail;
    this.tail.prev = this.head;

    // Metrics tracked for the analytics dashboard.
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };
  }

  /**
   * Detaches a node from wherever it currently sits in the list.
   * This is an internal helper - it does NOT update the map.
   * @param {Node} node
   */
  _detach(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  /**
   * Inserts a node immediately after the sentinel head (making it MRU).
   * @param {Node} node
   */
  _insertAtHead(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  /**
   * Promotes an existing node to MRU position.
   * Called on every successful cache hit.
   * @param {Node} node
   */
  _moveToHead(node) {
    this._detach(node);
    this._insertAtHead(node);
  }

  /**
   * Removes the LRU node (the one just before the tail sentinel).
   * Called when capacity is exceeded on a put().
   */
  _evictLRU() {
    const lruNode = this.tail.prev;
    if (lruNode === this.head) return; // Cache is empty, nothing to evict.
    this._detach(lruNode);
    this.map.delete(lruNode.key);
    this.stats.evictions++;
  }

  /**
   * Retrieves a value by key.
   * Returns null on cache miss or if the entry has expired.
   * On a hit, the node is promoted to MRU position.
   * @param {string} key
   * @returns {*|null}
   */
  get(key) {
    const node = this.map.get(key);

    if (!node) {
      this.stats.misses++;
      return null;
    }

    // Lazy TTL check. If the entry has expired, treat it as a miss.
    if (Date.now() > node.expiresAt) {
      this._detach(node);
      this.map.delete(key);
      this.stats.expirations++;
      this.stats.misses++;
      return null;
    }

    this._moveToHead(node);
    this.stats.hits++;
    return node.value;
  }

  /**
   * Stores a key-value pair in the cache.
   * If the key already exists, the value is updated and the node is promoted.
   * If the cache is at capacity, the LRU entry is evicted first.
   * @param {string} key
   * @param {*} value
   * @param {number} [ttlMs] - Override the default TTL for this specific entry.
   */
  put(key, value, ttlMs) {
    const resolvedTtl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    const expiresAt = resolvedTtl > 0 ? Date.now() + resolvedTtl : Infinity;

    const existing = this.map.get(key);

    if (existing) {
      // Update in place and promote.
      existing.value = value;
      existing.expiresAt = expiresAt;
      this._moveToHead(existing);
      return;
    }

    if (this.map.size >= this.capacity) {
      this._evictLRU();
    }

    const node = new Node(key, value, expiresAt);
    this.map.set(key, node);
    this._insertAtHead(node);
  }

  /**
   * Removes a specific entry from the cache.
   * Used when we want to explicitly invalidate a cached response
   * (e.g., after a POST/PUT/DELETE to the same resource).
   * @param {string} key
   */
  delete(key) {
    const node = this.map.get(key);
    if (!node) return false;
    this._detach(node);
    this.map.delete(key);
    return true;
  }

  /**
   * Removes all entries. Called on route config changes.
   */
  clear() {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Returns a snapshot of current cache state for the dashboard.
   */
  getMetrics() {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.map.size,
      capacity: this.capacity,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : "0.00",
    };
  }
}

export default LRUCache;
