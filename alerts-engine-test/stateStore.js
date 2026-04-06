const store = {}

function getState(ruleId) {
  return store[ruleId] || { entities: {} }
}

function setState(ruleId, state) {
  store[ruleId] = state
}

module.exports = { getState, setState }
