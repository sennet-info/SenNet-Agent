function evaluatePerEntity(prevState, currentEntities) {
  const state = {
    entities: { ...(prevState.entities || {}) },
    lastRunAt: new Date().toISOString()
  }

  const events = []

  for (const entity of currentEntities) {
    const prev = state.entities[entity.entityId]

    const prevStatus = prev?.status || "ok"
    const currStatus = entity.isFailing ? "fail" : "ok"

    if (prevStatus === "ok" && currStatus === "fail") {
      events.push({
        type: "ALERT",
        entityId: entity.entityId,
        meta: entity.meta
      })
    }

    if (prevStatus === "fail" && currStatus === "ok") {
      events.push({
        type: "RECOVERY",
        entityId: entity.entityId,
        meta: entity.meta
      })
    }

    state.entities[entity.entityId] = {
      status: currStatus,
      lastChangeAt:
        prevStatus !== currStatus
          ? new Date().toISOString()
          : prev?.lastChangeAt || new Date().toISOString()
    }
  }

  return { newState: state, events }
}

module.exports = { evaluatePerEntity }
