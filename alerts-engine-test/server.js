const express = require("express")
const { evaluatePerEntity } = require("./alertEngine")
const { batteryToEntities } = require("./batteryAdapter")
const { getState, setState } = require("./stateStore")

const app = express()
app.use(express.json())

app.post("/test/battery", (req, res) => {
  const { ruleId, batteries, threshold } = req.body

  console.log("\n--- REQUEST ---")
  console.log(JSON.stringify(req.body, null, 2))

  const prevState = getState(ruleId)

  const entities = batteryToEntities(batteries, threshold)

  const { newState, events } = evaluatePerEntity(prevState, entities)

  setState(ruleId, newState)

  console.log("--- EVENTS ---")
  console.log(events)

  console.log("--- STATE ---")
  console.log(JSON.stringify(newState, null, 2))

  res.json({
    events,
    state: newState
  })
})

app.listen(3000, () => {
  console.log("✅ Server running on http://localhost:3000")
})
