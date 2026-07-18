import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  deriveStreak,
  mergeDailyContributions,
  qualifyEvent,
  renderStreakCard,
} from "./streak-core.mjs";

const username = process.env.GITHUB_USERNAME || "atrx07";
const timeZone = process.env.STREAK_TIMEZONE || "Asia/Kolkata";
const token = process.env.STREAK_TOKEN || process.env.GITHUB_TOKEN;
const apiBase = "https://api.github.com";
const statePath = "data/streak-state.json";
const cardPath = "assets/streak.svg";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${username}-rolling-streak`,
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

async function github(path, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${apiBase}${path}`, { headers });
    if (response.ok) {
      return response.json();
    }

    const details = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`GitHub API ${response.status}: ${details}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 1000 * 2 ** (attempt - 1);
    console.warn(
      `GitHub API ${response.status}; retrying in ${delayMs / 1000}s (${attempt}/${maxAttempts}).`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("GitHub API request exhausted its retry budget.");
}

async function loadState() {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    return {
      version: 1,
      username,
      timeZone,
      bestStreak: Number(state.bestStreak) || 0,
      contributions: Array.isArray(state.contributions) ? state.contributions : [],
      processedEventIds: Array.isArray(state.processedEventIds)
        ? state.processedEventIds.map(String)
        : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return {
      version: 1,
      username,
      timeZone,
      bestStreak: 0,
      contributions: [],
      processedEventIds: [],
    };
  }
}

async function getRecentEvents() {
  const events = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await github(
      `/users/${encodeURIComponent(username)}/events?per_page=100&page=${page}`,
    );
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

async function main() {
  const [state, events] = await Promise.all([loadState(), getRecentEvents()]);
  const processed = new Set(state.processedEventIds);
  const repositoryCache = new Map();
  const getRepository = async (fullName) => {
    if (!repositoryCache.has(fullName)) {
      repositoryCache.set(
        fullName,
        github(`/repos/${fullName}`).catch((error) => {
          console.warn(`Could not inspect ${fullName}: ${error.message}`);
          return null;
        }),
      );
    }
    return repositoryCache.get(fullName);
  };

  const newEvents = events
    .filter((event) => !processed.has(String(event.id)))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const newContributions = [];

  for (const event of newEvents) {
    const contribution = await qualifyEvent(event, {
      username,
      timeZone,
      getRepository,
    });
    if (contribution) {
      newContributions.push(contribution);
    }
  }

  const contributions = mergeDailyContributions(
    state.contributions,
    newContributions,
    timeZone,
  );
  const now = process.env.STREAK_NOW ? new Date(process.env.STREAK_NOW) : new Date();
  const streak = deriveStreak(contributions, now, timeZone, state.bestStreak);
  const processedEventIds = [
    ...new Set([...events.map((event) => String(event.id)), ...state.processedEventIds]),
  ].slice(0, 1000);
  const nextState = {
    version: 1,
    username,
    timeZone,
    bestStreak: streak.bestStreak,
    contributions: streak.contributions,
    processedEventIds,
  };

  await Promise.all([
    mkdir("data", { recursive: true }),
    mkdir("assets", { recursive: true }),
  ]);
  await Promise.all([
    writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8"),
    writeFile(cardPath, renderStreakCard(streak, { username, timeZone }), "utf8"),
  ]);

  console.log(
    [
      `Processed ${newEvents.length} new events.`,
      `Found ${newContributions.length} qualifying contributions.`,
      `Current streak: ${streak.currentStreak}.`,
      `Best streak: ${streak.bestStreak}.`,
      `Status: ${streak.active ? "active" : "standby"}.`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
