function batteryToEntities(batteries, threshold) {
  return batteries.map(b => ({
    entityId: b.deviceId,
    isFailing: b.battery < threshold,
    meta: b
  }))
}

module.exports = { batteryToEntities }
