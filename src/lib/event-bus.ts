type Handler<Payload> = (payload: Payload) => void;

type Unsubscribe = () => void;

export type EventMap = Record<string, unknown>;

export function createEventBus<Events extends EventMap>() {
  const handlers = new Map<keyof Events, Set<Handler<Events[keyof Events]>>>();

  function on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): Unsubscribe {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)?.add(handler as Handler<Events[keyof Events]>);
    return () => {
      handlers.get(event)?.delete(handler as Handler<Events[keyof Events]>);
    };
  }

  function emit<K extends keyof Events>(event: K, payload: Events[K]) {
    handlers.get(event)?.forEach((handler) => {
      handler(payload);
    });
  }

  function clear() {
    handlers.clear();
  }

  return { on, emit, clear };
}
