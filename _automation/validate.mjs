import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AUTHOR_EMAIL,
  AUTHOR_NAME,
  BRANCH,
  DATE_RANGES,
  EXPECTED_TOTAL,
  MAX_FIRST_OF_MONTH,
  MAX_PER_DAY,
} from "./config.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`
    )
  }
  return result.stdout?.trim() ?? ""
}

function parseCommitLine(line) {
  const parts = line.split("|")
  if (parts.length < 4) {
    return null
  }
  const [hash, authorName, authorEmail, dateStr] = parts
  return { hash, authorName, authorEmail, date: new Date(dateStr) }
}

function parseDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function isFirstOfMonth(date) {
  return date.getUTCDate() === 1
}

function dayKey(date) {
  return date.toISOString().slice(0, 10)
}

function isWithinRanges(date, ranges) {
  for (const { start, end } of ranges) {
    const rangeStart = parseDate(start)
    const rangeEnd = parseDate(end)
    rangeEnd.setUTCHours(23, 59, 59, 999)
    if (date >= rangeStart && date <= rangeEnd) {
      return true
    }
  }
  return false
}

export function validate() {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch !== BRANCH) {
    throw new Error(`Expected branch ${BRANCH}, got ${branch}`)
  }

  const branches = run("git", ["branch", "--list"])
  const branchLines = branches.split("\n").map((b) => b.trim().replace(/^\* /, ""))
  if (branchLines.length !== 1 || branchLines[0] !== BRANCH) {
    throw new Error(`Only ${BRANCH} should exist, found: ${branchLines.join(", ")}`)
  }

  const raw = run("git", [
    "log",
    BRANCH,
    "--format=%H|%an|%ae|%aI",
  ])
  const commits = raw
    .split("\n")
    .filter(Boolean)
    .map(parseCommitLine)
    .filter(Boolean)

  const total = commits.length
  if (total !== EXPECTED_TOTAL) {
    throw new Error(
      `Abort: expected exactly ${EXPECTED_TOTAL} commits, got ${total}`
    )
  }

  const perDay = new Map()
  let activeDays = 0

  for (const commit of commits) {
    if (commit.authorName !== AUTHOR_NAME || commit.authorEmail !== AUTHOR_EMAIL) {
      throw new Error(
        `Unexpected author on ${commit.hash}: ${commit.authorName} <${commit.authorEmail}>`
      )
    }

    if (!isWithinRanges(commit.date, DATE_RANGES)) {
      throw new Error(
        `Commit ${commit.hash} is outside allowed ranges: ${commit.date.toISOString()}`
      )
    }

    if (!commit.hash) {
      continue
    }

    const msg = run("git", ["log", "-1", "--format=%s", commit.hash])
    if (!msg.startsWith("feat: ")) {
      throw new Error(`Commit ${commit.hash} message must start with 'feat: ': ${msg}`)
    }

    const key = dayKey(commit.date)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }

  let maxDay = 0
  for (const [key, count] of perDay) {
    activeDays++
    maxDay = Math.max(maxDay, count)
    const date = parseDate(key)
    const limit = isFirstOfMonth(date) ? MAX_FIRST_OF_MONTH : MAX_PER_DAY
    if (count > limit) {
      throw new Error(`${key} has ${count} commits (limit ${limit})`)
    }
  }

  return { total, maxDay, activeDays }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stats = validate()
  console.log(JSON.stringify(stats, null, 2))
}
