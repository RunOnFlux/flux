const chai = require('chai');

const { expect } = chai;

const topologicalSort = require('../../HomeUI/src/utils/topologicalSort');

describe('topologicalSort tests', () => {
  it('should return an empty array if the graph is empty', () => {
    const graph = {};

    const sorted = topologicalSort(graph);
    expect(sorted).to.deep.equal([]);
  });

  it('should return an empty array if there is a cycle', () => {
    const graph = { a: ['b'], b: ['a'] };

    const sorted = topologicalSort(graph);
    expect(sorted).to.deep.equal([]);
  });

  it('should ignore any dependency missing from the graph', () => {
    const graph = { a: ['b'], b: ['c'], d: ['a'] };

    const sorted = topologicalSort(graph);
    expect(sorted).to.deep.equal(['d', 'a', 'b']);
  });

  it('should sort graphs based on dependencies', () => {
    const expected = [
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['f', 'e', 'd', 'c', 'b', 'a'],
    ];
    const graphs = [
      {
        a: ['b', 'c'],
        b: ['c', 'd', 'e'],
        c: ['f'],
        d: [],
        e: ['f'],
        f: [],
      },
      {
        a: ['b', 'c'],
        b: ['c', 'd'],
        c: ['d'],
        d: ['e'],
        e: ['f'],
        f: [],
      },
      {
        a: [],
        b: ['a'],
        c: ['b'],
        d: ['c'],
        e: ['d'],
        f: ['e'],
      },
    ];

    graphs.forEach((graph, index) => {
      const sorted = topologicalSort(graph);
      expect(sorted).to.deep.equal(expected[index]);
    });
  });
});
