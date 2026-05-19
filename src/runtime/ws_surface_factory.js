/**
 * wsSurface creates a WebSocket surface descriptor for use with composable host.
 *
 * Usage:
 *   host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))
 */
export function wsSurface(options = {}) {
  return {
    type: 'ws',
    options: {
      path: options.path || '/api/runtime/ws',
      createSessionId: options.createSessionId,
    },
  }
}
