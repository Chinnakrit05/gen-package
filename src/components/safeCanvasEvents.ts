import { events } from '@react-three/fiber'

// React StrictMode can dispose an old Canvas while its async renderer setup is
// still completing. Fiber then asks the stale event manager to connect to a
// ref that has already become null. The live Canvas still connects normally.
export const safeCanvasEvents: typeof events = (store) => {
  const manager = events(store)
  const connect = manager.connect

  return {
    ...manager,
    connect(target) {
      if (target) connect?.(target)
    },
  }
}
