(function initNextVGraphMapping(globalScope) {
  const scope = globalScope || (typeof globalThis !== 'undefined' ? globalThis : {})

  function getControlProvenanceClass(value) {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (normalized === 'bounded') return 'bounded'
    if (normalized === 'unbounded') return 'unbounded'
    if (normalized === 'mixed') return 'mixed'
    return 'unknown'
  }

  function getControlOverlayClassName(provenance, overlayEnabled = true) {
    if (overlayEnabled === false) return 'control-overlay-off'
    return `control-${getControlProvenanceClass(provenance)}`
  }

  function buildControlGraphArtifacts(rawControlEdges) {
    const sourceEdges = Array.isArray(rawControlEdges) ? rawControlEdges : []
    const controlNodeById = new Map()
    const controlGraphEdges = []

    for (const rawEdge of sourceEdges) {
      const from = String(rawEdge?.from ?? '').trim()
      const to = String(rawEdge?.to ?? '').trim()
      if (!from || !to) continue

      const provenance = getControlProvenanceClass(rawEdge?.provenance)
      if (!controlNodeById.has(to)) {
        controlNodeById.set(to, {
          id: to,
          kind: 'control_branch',
          eventType: String(rawEdge?.eventType ?? '').trim(),
          branch: String(rawEdge?.branch ?? '').trim(),
          provenance,
          sourcePath: String(rawEdge?.sourcePath ?? '').trim(),
          sourceLine: Number.isFinite(Number(rawEdge?.sourceLine)) ? Number(rawEdge.sourceLine) : null,
          statement: String(rawEdge?.statement ?? '').trim(),
        })
      }

      controlGraphEdges.push({
        from,
        to,
        type: 'control',
        branch: String(rawEdge?.branch ?? '').trim(),
        eventType: String(rawEdge?.eventType ?? '').trim(),
        provenance,
        boundedControl: rawEdge?.boundedControl === true,
        line: Number.isFinite(Number(rawEdge?.line)) ? Number(rawEdge.line) : null,
        statement: String(rawEdge?.statement ?? '').trim(),
      })
    }

    return {
      controlNodes: Array.from(controlNodeById.values()),
      controlGraphEdges,
    }
  }

  scope.nextVGraphMapping = {
    getControlProvenanceClass,
    getControlOverlayClassName,
    buildControlGraphArtifacts,
  }
})(typeof globalThis !== 'undefined' ? globalThis : undefined)
