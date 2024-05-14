/* eslint max-classes-per-file: 0 */

class Node {
  prev = null;

  next = null;

  constructor(value) {
    this.value = value;
  }
}

class Queue {
  #dummyHead = new Node();

  #dummyTail = new Node();

  #length = 0;

  constructor() {
    this.#dummyHead.prev = this.#dummyTail;
    this.#dummyTail.next = this.#dummyHead;
  }

  /**
 * Determines if the queue is empty.
 * @return {boolean} `true` if the queue has no items, `false` otherwise.
 */
  get isEmpty() {
    return this.#length === 0;
  }

  /**
   * Returns the item at the front of the queue without removing it from the queue.
   * @return {*} The item at the front of the queue if it is not empty, `undefined` otherwise.
   */
  get front() {
    if (this.isEmpty) {
      return undefined;
    }

    return this.#dummyHead.prev.value;
  }

  /**
   * Returns the item at the back of the queue without removing it from the queue it.
   * @return {*} The item at the back of the queue if it is not empty, `undefined` otherwise.
   */
  get back() {
    if (this.isEmpty) {
      return undefined;
    }

    return this.#dummyTail.next.value;
  }

  /**
   * Returns the number of items in the queue.
   * @return {number} The number of items in the queue.
   */
  get length() {
    return this.#length;
  }

  /**
   * Adds an item to the back of the queue.
   * @param {*} item The item to be pushed onto the queue.
   * @return {number} The new length of the queue.
   */
  enqueue(item) {
    const node = new Node(item);
    const prevLast = this.#dummyTail.next;
    prevLast.prev = node;

    node.next = prevLast;
    node.prev = this.#dummyTail;
    this.#dummyTail.next = node;
    this.#length += 1;
    return this.#length;
  }

  /**
   * Remove an item from the front of the queue.
   * @return {*} The item at the front of the queue if it is not empty, `undefined` otherwise.
   */
  dequeue() {
    if (this.isEmpty) {
      return undefined;
    }

    const node = this.#dummyHead.prev;
    const newFirst = node.prev;
    this.#dummyHead.prev = newFirst;
    newFirst.next = this.#dummyHead;
    // Unlink the node to be dequeued.
    node.prev = null;
    node.next = null;
    this.#length -= 1;
    return node.value;
  }
}

/**
 * Sort a DAG topologically. Used for docker compose dependencies
 * @param {Object} graph Node to array of neighboring nodes.
 * @return {Array<string>} A topological traversal of nodes.
 *
 * Kahn's Algorithm:
 *   - Initialize a queue and a list to store the sorted nodes.
 *   - For each node in the graph, if it has no incoming edges, add it to the queue.
 *   - While the queue is not empty:
 *   - Dequeue a node from the front of the queue.
 *   - Add this node to the list of sorted nodes.
 *   - For each child of this node, decrease its in-degree (the number of incoming edges) by 1.
 *   - If a child's in-degree becomes 0, add it to the queue.
 *   - If the length of the sorted list is less than the number of nodes in the graph, this means
 *     that there is a cycle in the graph, and no topological ordering is possible.
 */
function topologicalSort(graph) {
  const nodes = new Map();
  const queue = new Queue();
  const order = [];

  Object.keys(graph).forEach((node) => {
    nodes.set(node, { in: 0, out: new Set(graph[node]) });
  });

  Object.keys(graph).forEach((node) => {
    graph[node].forEach((neighbor) => {
      if (nodes.has(neighbor)) nodes.get(neighbor).in += 1;
    });
  });

  nodes.forEach((value, node) => {
    if (value.in === 0) {
      queue.enqueue(node);
    }
  });

  while (queue.length) {
    const node = queue.dequeue();

    nodes.get(node).out.forEach((neighbor) => {
      if (nodes.has(neighbor)) {
        nodes.get(neighbor).in -= 1;
        if (nodes.get(neighbor).in === 0) {
          queue.enqueue(neighbor);
        }
      }
    });

    order.push(node);
  }

  // Return topological sorted array if it has the same length as
  // the number of keys in the graph, otherwise there is a cycle
  // and we return an empty array.
  return order.length === Object.keys(graph).length ? order : [];
}

module.exports = topologicalSort;
