export const WINDOW_MS = 24 * 60 * 60 * 1000;

const CONTRIBUTION_TYPES = new Map([
  ["IssuesEvent", { action: "opened", label: "ISSUE OPENED" }],
  ["PullRequestEvent", { action: "opened", label: "PULL REQUEST" }],
  ["PullRequestReviewEvent", { action: "created", label: "REVIEW SUBMITTED" }],
  ["DiscussionEvent", { action: "created", label: "DISCUSSION OPENED" }],
  ["DiscussionCommentEvent", { action: "created", label: "DISCUSSION ANSWER" }],
]);

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function localDayKey(value, timeZone = "Asia/Kolkata") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid contribution timestamp: ${value}`);
  }

  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function mergeDailyContributions(
  existing = [],
  incoming = [],
  timeZone = "Asia/Kolkata",
) {
  const earliestByDay = new Map();
  const records = [...existing, ...incoming]
    .filter((record) => record?.id && record?.at)
    .map((record) => ({
      ...record,
      id: String(record.id),
      day: localDayKey(record.at, timeZone),
    }))
    .sort((a, b) => {
      const timeDifference = new Date(a.at).getTime() - new Date(b.at).getTime();
      return timeDifference || a.id.localeCompare(b.id);
    });

  for (const record of records) {
    if (!earliestByDay.has(record.day)) {
      earliestByDay.set(record.day, record);
    }
  }

  return [...earliestByDay.values()];
}

export function deriveStreak(
  contributions,
  now = new Date(),
  timeZone = "Asia/Kolkata",
  bestFloor = 0,
) {
  const days = mergeDailyContributions([], contributions, timeZone);
  let sequence = 0;
  let bestStreak = Math.max(0, Number(bestFloor) || 0);
  let previousTime = null;

  for (const contribution of days) {
    const contributionTime = new Date(contribution.at).getTime();
    const insidePreviousWindow =
      previousTime !== null &&
      contributionTime > previousTime &&
      contributionTime - previousTime < WINDOW_MS;

    sequence = insidePreviousWindow ? sequence + 1 : 1;
    bestStreak = Math.max(bestStreak, sequence);
    previousTime = contributionTime;
  }

  const lastContribution = days.at(-1) || null;
  const lastTime = lastContribution ? new Date(lastContribution.at).getTime() : null;
  const deadlineTime = lastTime === null ? null : lastTime + WINDOW_MS;
  const nowTime = new Date(now).getTime();
  const active =
    deadlineTime !== null &&
    Number.isFinite(nowTime) &&
    nowTime >= lastTime &&
    nowTime < deadlineTime;

  return {
    active,
    bestStreak,
    currentStreak: active ? sequence : 0,
    deadlineAt: deadlineTime === null ? null : new Date(deadlineTime).toISOString(),
    lastContribution,
    qualifyingDays: days.length,
    contributions: days,
  };
}

export async function qualifyEvent(
  event,
  {
    username = "atrx07",
    timeZone = "Asia/Kolkata",
    getRepository = async () => ({ fork: false, default_branch: "main" }),
  } = {},
) {
  if (
    !event?.id ||
    !event?.created_at ||
    event.actor?.login?.toLowerCase() !== username.toLowerCase()
  ) {
    return null;
  }

  const baseRecord = {
    id: String(event.id),
    at: new Date(event.created_at).toISOString(),
    day: localDayKey(event.created_at, timeZone),
    eventType: event.type,
    repo: event.repo?.name || "github.com",
  };

  if (event.type === "ForkEvent") {
    return { ...baseRecord, label: "REPOSITORY FORKED" };
  }

  if (event.type === "CreateEvent" && event.payload?.ref_type === "repository") {
    return { ...baseRecord, label: "REPOSITORY CREATED" };
  }

  const simpleType = CONTRIBUTION_TYPES.get(event.type);
  const isSimpleMatch = simpleType && event.payload?.action === simpleType.action;
  const isPush = event.type === "PushEvent";

  if (!isSimpleMatch && !isPush) {
    return null;
  }

  if (!event.repo?.name) {
    return null;
  }

  const repository = await getRepository(event.repo.name);
  if (!repository || repository.fork || repository.archived) {
    return null;
  }

  if (isPush) {
    const pushedBranch = event.payload?.ref?.replace("refs/heads/", "");
    const isContributionBranch =
      pushedBranch === repository.default_branch || pushedBranch === "gh-pages";

    if (!isContributionBranch) {
      return null;
    }

    return { ...baseRecord, label: "CODE PUSHED" };
  }

  return { ...baseRecord, label: simpleType.label };
}

function formatDeadline(value, timeZone) {
  if (!value) {
    return "AWAITING NEXT SIGNAL";
  }

  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;

  return `${part("day")} ${part("month")} // ${part("hour")}:${part("minute")} IST`;
}

function energyMessage(streak) {
  if (streak === 0) return "STANDBY // NEXT CONTRIBUTION STARTS THE ENGINE";
  if (streak === 1) return "IGNITION // FIRST DAY LOCKED";
  if (streak < 7) return "MOMENTUM // THE CHAIN IS ALIVE";
  if (streak < 14) return "LOCKED IN // ONE WEEK AND CLIMBING";
  if (streak < 30) return "RELENTLESS // KEEP THE SIGNAL ALIVE";
  return "OVERDRIVE // CONSISTENCY BECAME THE SYSTEM";
}

function shorten(value, maxLength = 28) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

export function renderStreakCard(
  streak,
  { username = "atrx07", timeZone = "Asia/Kolkata" } = {},
) {
  const activeColor = streak.active ? "#e8ff6b" : "#8b949e";
  const status = streak.active ? "ACTIVE" : "STANDBY";
  const lastLabel = streak.lastContribution
    ? `${streak.lastContribution.label} // ${shorten(streak.lastContribution.repo)}`
    : "NO QUALIFYING CONTRIBUTION RECORDED";
  const deadline = formatDeadline(streak.active ? streak.deadlineAt : null, timeZone);
  const message = energyMessage(streak.currentStreak);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220" viewBox="0 0 400 220" role="img" aria-labelledby="title desc">
  <title id="title">Rolling contribution streak for ${escapeXml(username)}</title>
  <desc id="desc">${escapeXml(status)} rolling 24-hour streak: ${streak.currentStreak}. Best streak: ${streak.bestStreak}.</desc>
  <style>
    .ui { font-family: "Segoe UI", Ubuntu, Arial, sans-serif; }
    .mono { font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace; }
  </style>
  <rect x="0.5" y="0.5" width="399" height="219" rx="6" fill="#0d1117" stroke="#e8ff6b"/>
  <path d="M0 42H400M0 184H400" stroke="#21262d"/>
  <path d="M315 0H400V85" fill="none" stroke="#30363d"/>
  <path d="M337 0H400V63" fill="none" stroke="#21262d"/>

  <text class="mono" x="20" y="27" fill="#e8ff6b" font-size="13" font-weight="700">ROLLING STREAK // 24H</text>
  <circle cx="325" cy="23" r="4" fill="${activeColor}"/>
  <text class="mono" x="337" y="27" fill="${activeColor}" font-size="11">${status}</text>

  <path d="M30 72L49 72L40 91L53 91L29 126L35 99L22 99Z" fill="#e8ff6b"/>
  <text class="ui" x="66" y="119" fill="#f0f6fc" font-size="64" font-weight="750">${streak.currentStreak}</text>
  <text class="mono" x="69" y="143" fill="#8b949e" font-size="11">CURRENT CHAIN</text>

  <text class="mono" x="218" y="73" fill="#8b949e" font-size="10">PERSONAL BEST</text>
  <text class="ui" x="218" y="104" fill="#f0f6fc" font-size="27" font-weight="700">${streak.bestStreak} DAYS</text>
  <text class="mono" x="218" y="128" fill="#8b949e" font-size="10">WINDOW CLOSES</text>
  <text class="mono" x="218" y="147" fill="${activeColor}" font-size="12" font-weight="700">${escapeXml(deadline)}</text>

  <text class="mono" x="20" y="171" fill="#8b949e" font-size="10">${escapeXml(lastLabel)}</text>
  <text class="mono" x="20" y="204" fill="#e8ff6b" font-size="10" font-weight="700">${escapeXml(message)}</text>
  <text class="mono" x="380" y="204" fill="#484f58" font-size="9" text-anchor="end">@${escapeXml(username)}</text>
</svg>
`;
}
