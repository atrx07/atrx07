import assert from "node:assert/strict";
import test from "node:test";
import {
  WINDOW_MS,
  deriveStreak,
  localDayKey,
  mergeDailyContributions,
  qualifyEvent,
  renderStreakCard,
} from "./streak-core.mjs";

const username = "atrx07";
const timeZone = "Asia/Kolkata";

function contribution(id, at, overrides = {}) {
  return {
    id: String(id),
    at,
    day: localDayKey(at, timeZone),
    eventType: "PushEvent",
    label: "CODE PUSHED",
    repo: "atrx07/project",
    ...overrides,
  };
}

function event(id, type, at, payload = {}, overrides = {}) {
  return {
    id: String(id),
    type,
    created_at: at,
    actor: { login: username },
    repo: { name: "atrx07/project" },
    payload,
    ...overrides,
  };
}

const standaloneRepo = async () => ({
  fork: false,
  archived: false,
  default_branch: "main",
});

test("empty history remains on standby", () => {
  const result = deriveStreak([], "2026-07-18T12:00:00.000Z", timeZone);
  assert.equal(result.active, false);
  assert.equal(result.currentStreak, 0);
  assert.equal(result.bestStreak, 0);
  assert.equal(result.deadlineAt, null);
});

test("first contribution starts a 24-hour streak", () => {
  const at = "2026-07-18T10:00:00.000Z";
  const result = deriveStreak([contribution(1, at)], "2026-07-18T10:01:00.000Z", timeZone);
  assert.equal(result.active, true);
  assert.equal(result.currentStreak, 1);
  assert.equal(result.bestStreak, 1);
  assert.equal(
    new Date(result.deadlineAt).getTime() - new Date(at).getTime(),
    WINDOW_MS,
  );
});

test("same-day contributions keep the count and reset the inactivity window", () => {
  const first = "2026-07-18T02:00:00.000Z";
  const later = "2026-07-18T12:00:00.000Z";
  const result = deriveStreak(
    [contribution(1, first), contribution(2, later)],
    "2026-07-18T12:01:00.000Z",
    timeZone,
  );
  assert.equal(result.currentStreak, 1);
  assert.equal(result.contributions.length, 1);
  assert.equal(result.lastContribution.firstAt, first);
  assert.equal(result.lastContribution.at, later);
  assert.equal(
    result.deadlineAt,
    new Date(new Date(later).getTime() + WINDOW_MS).toISOString(),
  );
});

test("a late same-day contribution preserves the chain into the next day", () => {
  const result = deriveStreak(
    [
      contribution(1, "2026-07-18T00:00:00.000Z"),
      contribution(2, "2026-07-18T16:00:00.000Z"),
      contribution(3, "2026-07-19T15:00:00.000Z"),
    ],
    "2026-07-19T15:01:00.000Z",
    timeZone,
  );
  assert.equal(result.currentStreak, 2);
  assert.equal(result.contributions[0].firstAt, "2026-07-18T00:00:00.000Z");
  assert.equal(result.contributions[0].at, "2026-07-18T16:00:00.000Z");
});

test("a new day inside the window increments and resets the deadline", () => {
  const first = "2026-07-18T02:00:00.000Z";
  const second = "2026-07-19T01:59:59.000Z";
  const result = deriveStreak(
    [contribution(1, first), contribution(2, second)],
    "2026-07-19T02:00:00.000Z",
    timeZone,
  );
  assert.equal(result.currentStreak, 2);
  assert.equal(result.bestStreak, 2);
  assert.equal(
    result.deadlineAt,
    new Date(new Date(second).getTime() + WINDOW_MS).toISOString(),
  );
});

test("an event exactly at 24 hours starts a new chain", () => {
  const first = "2026-07-18T02:00:00.000Z";
  const second = "2026-07-19T02:00:00.000Z";
  const result = deriveStreak(
    [contribution(1, first), contribution(2, second)],
    "2026-07-19T02:01:00.000Z",
    timeZone,
  );
  assert.equal(result.currentStreak, 1);
  assert.equal(result.bestStreak, 1);
});

test("an expired chain resets to zero while preserving the best", () => {
  const at = "2026-07-18T02:00:00.000Z";
  const result = deriveStreak(
    [contribution(1, at)],
    "2026-07-19T02:00:00.000Z",
    timeZone,
    7,
  );
  assert.equal(result.active, false);
  assert.equal(result.currentStreak, 0);
  assert.equal(result.bestStreak, 7);
});

test("late events are sorted and reconstruct the correct chain", () => {
  const records = [
    contribution(3, "2026-07-20T01:00:00.000Z"),
    contribution(1, "2026-07-18T01:02:00.000Z"),
    contribution(2, "2026-07-19T01:01:00.000Z"),
  ];
  const result = deriveStreak(records, "2026-07-20T01:05:00.000Z", timeZone);
  assert.equal(result.currentStreak, 3);
  assert.deepEqual(
    result.contributions.map((item) => item.id),
    ["1", "2", "3"],
  );
});

test("a gap longer than 24 hours breaks the chain", () => {
  const result = deriveStreak(
    [
      contribution(1, "2026-07-18T01:00:00.000Z"),
      contribution(2, "2026-07-19T01:00:01.000Z"),
    ],
    "2026-07-19T01:01:00.000Z",
    timeZone,
  );
  assert.equal(result.currentStreak, 1);
  assert.equal(result.bestStreak, 1);
});

test("IST midnight creates a new streak day inside the rolling window", () => {
  const beforeMidnight = "2026-07-18T18:20:00.000Z";
  const afterMidnight = "2026-07-18T18:40:00.000Z";
  assert.equal(localDayKey(beforeMidnight, timeZone), "2026-07-18");
  assert.equal(localDayKey(afterMidnight, timeZone), "2026-07-19");
  const result = deriveStreak(
    [contribution(1, beforeMidnight), contribution(2, afterMidnight)],
    "2026-07-18T18:41:00.000Z",
    timeZone,
  );
  assert.equal(result.currentStreak, 2);
});

test("merging is idempotent and keeps both daily window boundaries", () => {
  const early = contribution(1, "2026-07-18T02:00:00.000Z");
  const late = contribution(2, "2026-07-18T12:00:00.000Z");
  const merged = mergeDailyContributions([late], [early, late], timeZone);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "2");
  assert.equal(merged[0].firstAt, early.at);
  assert.equal(merged[0].at, late.at);
});

test("default-branch and gh-pages pushes qualify with or without commit metadata", async () => {
  const mainPush = event(1, "PushEvent", "2026-07-18T02:00:00.000Z", {
    ref: "refs/heads/main",
  });
  const pagesPush = event(2, "PushEvent", "2026-07-19T02:00:00.000Z", {
    ref: "refs/heads/gh-pages",
    commits: [{ sha: "b" }],
  });
  assert.equal(
    (await qualifyEvent(mainPush, { username, timeZone, getRepository: standaloneRepo }))
      .label,
    "CODE PUSHED",
  );
  assert.equal(
    (await qualifyEvent(pagesPush, { username, timeZone, getRepository: standaloneRepo }))
      .label,
    "CODE PUSHED",
  );
});

test("feature-branch, fork, and archived pushes do not qualify", async () => {
  const featurePush = event(1, "PushEvent", "2026-07-18T02:00:00.000Z", {
    ref: "refs/heads/feature",
    commits: [{ sha: "a" }],
  });
  const mainPush = event(3, "PushEvent", "2026-07-18T02:00:00.000Z", {
    ref: "refs/heads/main",
    commits: [{ sha: "a" }],
  });
  assert.equal(
    await qualifyEvent(featurePush, { username, timeZone, getRepository: standaloneRepo }),
    null,
  );
  assert.equal(
    await qualifyEvent(mainPush, {
      username,
      timeZone,
      getRepository: async () => ({ fork: true, default_branch: "main" }),
    }),
    null,
  );
  assert.equal(
    await qualifyEvent(mainPush, {
      username,
      timeZone,
      getRepository: async () => ({
        fork: false,
        archived: true,
        default_branch: "main",
      }),
    }),
    null,
  );
});

test("GitHub contribution event types qualify only for their creation action", async () => {
  const cases = [
    ["IssuesEvent", "opened", "ISSUE OPENED"],
    ["PullRequestEvent", "opened", "PULL REQUEST"],
    ["PullRequestReviewEvent", "created", "REVIEW SUBMITTED"],
    ["DiscussionEvent", "created", "DISCUSSION OPENED"],
    ["DiscussionCommentEvent", "created", "DISCUSSION ANSWER"],
  ];
  let id = 10;
  for (const [type, action, label] of cases) {
    const result = await qualifyEvent(
      event(id++, type, "2026-07-18T02:00:00.000Z", { action }),
      { username, timeZone, getRepository: standaloneRepo },
    );
    assert.equal(result.label, label);
  }
  assert.equal(
    await qualifyEvent(
      event(99, "IssuesEvent", "2026-07-18T02:00:00.000Z", { action: "closed" }),
      { username, timeZone, getRepository: standaloneRepo },
    ),
    null,
  );
});

test("repository creation and fork events qualify without repository lookup", async () => {
  const shouldNotRun = async () => {
    throw new Error("repository lookup should not run");
  };
  const created = await qualifyEvent(
    event(1, "CreateEvent", "2026-07-18T02:00:00.000Z", {
      ref_type: "repository",
    }),
    { username, timeZone, getRepository: shouldNotRun },
  );
  const forked = await qualifyEvent(
    event(2, "ForkEvent", "2026-07-19T02:00:00.000Z"),
    { username, timeZone, getRepository: shouldNotRun },
  );
  assert.equal(created.label, "REPOSITORY CREATED");
  assert.equal(forked.label, "REPOSITORY FORKED");
});

test("events from another actor and unsupported events are ignored", async () => {
  const foreign = event(
    1,
    "PushEvent",
    "2026-07-18T02:00:00.000Z",
    { ref: "refs/heads/main", commits: [{ sha: "a" }] },
    { actor: { login: "someone-else" } },
  );
  assert.equal(
    await qualifyEvent(foreign, { username, timeZone, getRepository: standaloneRepo }),
    null,
  );
  assert.equal(
    await qualifyEvent(event(2, "WatchEvent", "2026-07-18T02:00:00.000Z"), {
      username,
      timeZone,
      getRepository: standaloneRepo,
    }),
    null,
  );
});

test("active and standby SVGs expose their state accessibly", () => {
  const active = deriveStreak(
    [contribution(1, "2026-07-18T02:00:00.000Z")],
    "2026-07-18T03:00:00.000Z",
    timeZone,
  );
  const activeSvg = renderStreakCard(active, { username, timeZone });
  assert.match(activeSvg, /ACTIVE/);
  assert.match(activeSvg, /IGNITION/);
  assert.match(activeSvg, /Rolling contribution streak/);
  assert.doesNotMatch(activeSvg, /undefined/);

  const standby = deriveStreak(
    [contribution(1, "2026-07-18T02:00:00.000Z")],
    "2026-07-19T02:00:00.000Z",
    timeZone,
  );
  const standbySvg = renderStreakCard(standby, { username, timeZone });
  assert.match(standbySvg, /STANDBY/);
  assert.match(standbySvg, /NEXT CONTRIBUTION STARTS THE ENGINE/);
  assert.match(standbySvg, /AWAITING NEXT SIGNAL/);
  assert.doesNotMatch(standbySvg, /19 Jul \/\/ 07:30 IST/);
});
