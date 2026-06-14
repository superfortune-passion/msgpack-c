import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AUTHOR_EMAIL,
  AUTHOR_NAME,
  BRANCH,
  CONTRIB_FILE,
  DATE_RANGES,
  MAX_FIRST_OF_MONTH,
  MAX_PER_DAY,
  TARGET_COMMITS,
} from "./config.mjs"
import { FEAT_MESSAGES } from "./messages.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

function run(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`
    )
  }
  return result.stdout?.trim() ?? ""
}

function runOptional(cmd, args, env = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

function resetHistory() {
  const hasHead = runOptional("git", ["rev-parse", "HEAD"]).status === 0
  if (!hasHead) {
    run("git", ["checkout", "-B", BRANCH])
    return
  }

  run("git", ["checkout", "--orphan", "_history_reset"])
  run("git", ["reset"])
  if (runOptional("git", ["branch", "-D", BRANCH]).status === 0) {
    // old main removed
  }
  run("git", ["branch", "-m", BRANCH])
}

function parseDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function buildDayList(ranges) {
  const days = []
  for (const { start, end } of ranges) {
    const startDate = parseDate(start)
    const endDate = parseDate(end)
    const cur = new Date(startDate)
    while (cur.getTime() <= endDate.getTime()) {
      days.push(new Date(cur))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }
  return days
}

function isFirstOfMonth(date) {
  return date.getUTCDate() === 1
}

function distributeCommits(total, days) {
  const counts = new Array(days.length).fill(0)
  const slots = []

  for (let day = 0; day < days.length; day++) {
    const max = isFirstOfMonth(days[day]) ? MAX_FIRST_OF_MONTH : MAX_PER_DAY
    for (let i = 0; i < max; i++) {
      slots.push(day)
    }
  }

  if (total > slots.length) {
    throw new Error(
      `Cannot place ${total} commits across ${days.length} days (max ${slots.length})`
    )
  }

  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }

  for (let i = 0; i < total; i++) {
    counts[slots[i]]++
  }

  return counts
}

function dayToTimestamp(day) {
  const date = new Date(day)
  const hour = 8 + Math.floor(Math.random() * 14)
  const minute = Math.floor(Math.random() * 60)
  const second = Math.floor(Math.random() * 60)
  date.setUTCHours(hour, minute, second, 0)
  return date
}

function formatGitDate(date) {
  const pad = (n) => String(n).padStart(2, "0")
  const offset = "+0000"
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${offset}`
}

function buildSchedule(total) {
  const days = buildDayList(DATE_RANGES)
  const counts = distributeCommits(total, days)
  const schedule = []

  for (let day = 0; day < counts.length; day++) {
    for (let i = 0; i < counts[day]; i++) {
      schedule.push(dayToTimestamp(days[day]))
    }
  }

  schedule.sort((a, b) => a.getTime() - b.getTime())
  return schedule
}

export function generate({ force = false } = {}) {
  if (force) {
    resetHistory()
    const contribPath = join(ROOT, CONTRIB_FILE)
    if (existsSync(contribPath)) {
      rmSync(contribPath)
    }
  } else {
    run("git", ["checkout", "-B", BRANCH])
  }

  const contribPath = join(ROOT, CONTRIB_FILE)
  mkdirSync(dirname(contribPath), { recursive: true })
  if (!existsSync(contribPath)) {
    writeFileSync(contribPath, "", "utf8")
  }

  const schedule = buildSchedule(TARGET_COMMITS)
  let body = existsSync(contribPath) ? readFileSync(contribPath, "utf8") : ""

  for (let i = 0; i < schedule.length; i++) {
    const message = FEAT_MESSAGES[i % FEAT_MESSAGES.length]
    body += `${i + 1}|${message}\n`
    writeFileSync(contribPath, body, "utf8")

    const gitDate = formatGitDate(schedule[i])
    const env = {
      GIT_AUTHOR_NAME: AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
      GIT_AUTHOR_DATE: gitDate,
      GIT_COMMITTER_DATE: gitDate,
    }

    run("git", ["add", CONTRIB_FILE], env)
    run("git", ["commit", "-m", message], env)
  }

  return { created: schedule.length }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes("--force")
  const result = generate({ force })
  console.log(`Generated ${result.created} commits on ${BRANCH}`)
}
