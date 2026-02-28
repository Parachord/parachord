const SearchHistoryService = require('../services/search-history-service');

function createMockStore() {
  const data = {};
  return {
    get: jest.fn((key, def) => data[key] !== undefined ? data[key] : def),
    set: jest.fn((key, val) => { data[key] = val; }),
    _data: data
  };
}

describe('SearchHistoryService', () => {
  let store, service;

  beforeEach(() => {
    store = createMockStore();
    service = new SearchHistoryService(store);
  });

  test('load returns empty array when no history', () => {
    expect(service.load()).toEqual([]);
  });

  test('save adds a new entry', () => {
    const result = service.save({ query: 'test song' });
    expect(result.success).toBe(true);
    expect(store.set).toHaveBeenCalledWith('search_history', expect.arrayContaining([
      expect.objectContaining({ query: 'test song', timestamp: expect.any(Number) })
    ]));
  });

  test('save updates existing entry (case-insensitive)', () => {
    store._data.search_history = [
      { query: 'Test Song', timestamp: 100 }
    ];

    service.save({ query: 'test song', selectedResult: { title: 'Result' } });
    const saved = store.set.mock.calls[0][1];
    expect(saved).toHaveLength(1);
    expect(saved[0].selectedResult).toEqual({ title: 'Result' });
    expect(saved[0].timestamp).toBeGreaterThan(100);
  });

  test('save rejects invalid entries', () => {
    expect(service.save(null).success).toBe(false);
    expect(service.save({}).success).toBe(false);
    expect(service.save({ query: '' }).success).toBe(false);
    expect(service.save({ query: '  ' }).success).toBe(false);
  });

  test('save trims to 50 entries', () => {
    const history = [];
    for (let i = 0; i < 55; i++) {
      history.push({ query: `query-${i}`, timestamp: i });
    }
    store._data.search_history = history;

    service.save({ query: 'new query' });
    const saved = store.set.mock.calls[0][1];
    expect(saved.length).toBeLessThanOrEqual(50);
  });

  test('save sorts by timestamp descending', () => {
    store._data.search_history = [
      { query: 'old', timestamp: 100 },
      { query: 'newer', timestamp: 200 }
    ];

    service.save({ query: 'newest' });
    const saved = store.set.mock.calls[0][1];
    expect(saved[0].query).toBe('newest');
  });

  test('clear removes specific entry (case-insensitive)', () => {
    store._data.search_history = [
      { query: 'Keep This', timestamp: 1 },
      { query: 'Remove This', timestamp: 2 }
    ];

    service.clear('remove this');
    const saved = store.set.mock.calls[0][1];
    expect(saved).toHaveLength(1);
    expect(saved[0].query).toBe('Keep This');
  });

  test('clear without query clears all', () => {
    store._data.search_history = [
      { query: 'a', timestamp: 1 },
      { query: 'b', timestamp: 2 }
    ];

    service.clear();
    expect(store.set).toHaveBeenCalledWith('search_history', []);
  });

  test('clear returns success', () => {
    expect(service.clear().success).toBe(true);
    expect(service.clear('test').success).toBe(true);
  });
});
