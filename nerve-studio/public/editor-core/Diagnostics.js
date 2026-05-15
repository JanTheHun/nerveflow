import { EventEmitter } from './internal/event_emitter.js'

export class DiagnosticsChannel {
  constructor() {
    this.diagnostics = []
    this.events = new EventEmitter()
  }

  setDiagnostics(diagnostics) {
    if (!Array.isArray(diagnostics)) {
      this.diagnostics = []
    } else {
      this.diagnostics = diagnostics
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({ ...item }))
    }

    const snapshot = this.getDiagnostics()
    this.events.emit('diagnostics', snapshot)
    return snapshot
  }

  addDiagnostic(diagnostic) {
    if (!diagnostic || typeof diagnostic !== 'object') {
      return this.getDiagnostics()
    }

    this.diagnostics.push({ ...diagnostic })
    const snapshot = this.getDiagnostics()
    this.events.emit('diagnostics', snapshot)
    return snapshot
  }

  clear() {
    this.diagnostics = []
    this.events.emit('diagnostics', [])
  }

  getDiagnostics() {
    return this.diagnostics.map((item) => ({ ...item }))
  }

  subscribe(listener) {
    return this.events.on('diagnostics', listener)
  }
}
