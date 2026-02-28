const WSManager = require('../lib/ws-manager');

// Minimal mock WebSocket
function createMockWS() {
  const handlers = {};
  return {
    readyState: 1, // OPEN
    on(event, handler) { handlers[event] = handler; },
    send: jest.fn(),
    _trigger(event, ...args) { if (handlers[event]) handlers[event](...args); },
    _handlers: handlers
  };
}

describe('WSManager', () => {
  let manager;

  beforeEach(() => {
    manager = new WSManager();
  });

  test('addClient tracks connection and returns ID', () => {
    const ws = createMockWS();
    const id = manager.addClient(ws);
    expect(id).toBeDefined();
    expect(manager.clientCount).toBe(1);
  });

  test('broadcast sends to all clients', () => {
    const ws1 = createMockWS();
    const ws2 = createMockWS();
    manager.addClient(ws1);
    manager.addClient(ws2);

    manager.broadcast('test:event', { data: 123 });

    expect(ws1.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'test:event', payload: { data: 123 } })
    );
    expect(ws2.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'test:event', payload: { data: 123 } })
    );
  });

  test('send targets a specific client', () => {
    const ws1 = createMockWS();
    const ws2 = createMockWS();
    const id1 = manager.addClient(ws1);
    manager.addClient(ws2);

    manager.send(id1, 'msg', { hello: true });

    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).not.toHaveBeenCalled();
  });

  test('on/off registers and removes handlers', () => {
    const handler = jest.fn();
    manager.on('test:type', handler);

    const ws = createMockWS();
    manager.addClient(ws);
    ws._trigger('message', JSON.stringify({ type: 'test:type', payload: { x: 1 } }));

    expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.any(String));

    manager.off('test:type', handler);
    ws._trigger('message', JSON.stringify({ type: 'test:type', payload: { x: 2 } }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('removes client on close', () => {
    const ws = createMockWS();
    manager.addClient(ws);
    expect(manager.clientCount).toBe(1);

    ws._trigger('close');
    expect(manager.clientCount).toBe(0);
  });

  test('dispatches client:connected on add', () => {
    const handler = jest.fn();
    manager.on('client:connected', handler);

    const ws = createMockWS();
    manager.addClient(ws);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: expect.any(String) }),
      undefined
    );
  });

  test('does not send to closed connections', () => {
    const ws = createMockWS();
    ws.readyState = 3; // CLOSED
    const id = manager.addClient(ws);

    manager.send(id, 'test', {});
    expect(ws.send).not.toHaveBeenCalled();
  });
});
