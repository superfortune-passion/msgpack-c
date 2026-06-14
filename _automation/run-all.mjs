import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { BRANCH } from "./config.mjs"
import { generate } from "./generate.mjs"
import { validate } from "./validate.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function ensureOriginRemote() {
  const list = spawnSync("git", ["remote"], { cwd: ROOT, encoding: "utf8" })
  const remotes = (list.stdout ?? "").trim().split("\n").filter(Boolean)
  if (remotes.includes("origin")) {
    return
  }
  if (remotes.includes("orgin")) {
    const url = spawnSync("git", ["remote", "get-url", "orgin"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout?.trim()
    if (url) {
      run("git", ["remote", "add", "origin", url])
      return
    }
  }
  throw new Error("No origin remote configured")
}

const force = process.argv.includes("--force")

console.log("=== generate ===")
generate({ force })

console.log("=== validate ===")
const stats = validate()
console.log(`total commits: ${stats.total}`)
console.log(`max/day: ${stats.maxDay}`)
console.log(`active days: ${stats.activeDays}`)

console.log("=== push origin/main ===")
ensureOriginRemote()
run("git", ["push", "-u", "origin", BRANCH, "--force"])

console.log("Done.")
