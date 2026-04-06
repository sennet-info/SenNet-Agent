const axios = require("axios")

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

  let r3 = await axios.post(URL, {
    ruleId: "rule-1",
    threshold: 30,
    batteries: [
      { deviceId: "bat-1", battery: 35 },
      { deviceId: "bat-2", battery: 44 }
    ]
  })

  console.log("STEP 3:", r3.data.events)

  console.log("\n===== TEST END =====\n")
}

run()
