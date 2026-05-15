export class Renderer {
  constructor() {
    this.tokens = []
    this.overlays = []
  }

  setTokens(tokens) {
    if (!Array.isArray(tokens)) {
      this.tokens = []
      return
    }

    this.tokens = tokens
      .filter((token) => token && typeof token === 'object')
      .map((token) => ({ ...token }))
  }

  getTokens() {
    return this.tokens.map((token) => ({ ...token }))
  }

  getTokensForLine(lineNumber) {
    if (!Number.isInteger(lineNumber)) {
      return []
    }

    return this.tokens
      .filter((token) => token.line === lineNumber)
      .map((token) => ({ ...token }))
  }

  setOverlays(overlays) {
    if (!Array.isArray(overlays)) {
      this.overlays = []
      return
    }

    this.overlays = overlays
      .filter((overlay) => overlay && typeof overlay === 'object')
      .map((overlay) => ({ ...overlay }))
  }

  getOverlays() {
    return this.overlays.map((overlay) => ({ ...overlay }))
  }
}
