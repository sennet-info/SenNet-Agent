const axios = require("axios")
const assert = require("assert")

const URL = "http://localhost:3000/test/battery"

async function run() {
  console.log("\n===== TEST START =====\n")

  let r1 = await axios.post(URL, {
    ruleId: "rule-1",
    threshold: 30,
    batteries: [
      { deviceId: "bat-1", battery: 17 },
      { deviceId: "bat-2", battery: 15 }
    ]
  })

  console.log("STEP 1:", r1.data.events)
  assert.strictEqual(r1.data.events.filter(e => e.type === "ALERT").length, 2, "STEP 1 debe generar 2 ALERT")
  assert.strictEqual(r1.data.state.entities["bat-1"].status, "fail")
  assert.strictEqual(r1.data.state.entities["bat-2"].status, "fail")

  let r2 = await axios.post(URL, {
    ruleId: "rule-1",
    threshold: 30,
    batteries: [
      { deviceId: "bat-1", battery: 35 },
      { deviceId: "bat-2", battery: 15 }
    ]
  })

  console.log("STEP 2:", r2.data.events)

  if (!r2.data.events.find(e => e.type === "RECOVERY")) {
    console.error("❌ ERROR: no recovery detectado")
  } else {
    console.log("✅ recovery parcial OK")
  }
  assert.ok(r2.data.events.find(e => e.type === "RECOVERY" && e.entityId === "bat-1"), "STEP 2 debe recuperar bat-1")
  assert.strictEqual(r2.data.state.entities["bat-1"].status, "ok")
  assert.strictEqual(r2.data.state.entities["bat-2"].status, "fail")

  let r3 = await axios.post(URL, {
    ruleId: "rule-1",
    threshold: 30,
    batteries: [
      { deviceId: "bat-1", battery: 35 },
      { deviceId: "bat-2", battery: 44 }
    ]
  })

  console.log("STEP 3:", r3.data.events)
  assert.ok(r3.data.events.find(e => e.type === "RECOVERY" && e.entityId === "bat-2"), "STEP 3 debe recuperar bat-2")
  assert.strictEqual(r3.data.state.entities["bat-2"].status, "ok")

  console.log("\n===== TEST END =====\n")
}

run()
