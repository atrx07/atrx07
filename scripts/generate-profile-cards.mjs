import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USERNAME || "atrx07";
const token = process.env.GITHUB_TOKEN;
const apiBase = "https://api.github.com";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${username}-profile-card-generator`,
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const languageColors = {
  C: "#555555",
  "C++": "#f34b7d",
  CSS: "#563d7c",
  HTML: "#e34c26",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Shell: "#89e051",
  TypeScript: "#3178c6",
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

async function github(path) {
  const response = await fetch(`${apiBase}${path}`, { headers });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub API ${response.status}: ${details}`);
  }

  return response.json();
}

async function getRepositories() {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
    );
    repositories.push(...batch);

    if (batch.length < 100) {
      return repositories;
    }
  }
}

function cardShell(title, subtitle, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180" viewBox="0 0 400 180" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(subtitle)}</desc>
  <style>
    .text { font-family: "Segoe UI", Ubuntu, Arial, sans-serif; }
    .label { fill: #8b949e; font-size: 12px; }
    .value { fill: #f0f6fc; font-size: 22px; font-weight: 700; }
  </style>
  <rect x="0.5" y="0.5" width="399" height="179" rx="6" fill="#0d1117" stroke="#e8ff6b"/>
  <text class="text" x="22" y="29" fill="#e8ff6b" font-size="14" font-weight="700">${escapeXml(title)}</text>
  <text class="text" x="22" y="48" fill="#8b949e" font-size="11">${escapeXml(subtitle)}</text>
  <path d="M22 60H378" stroke="#30363d"/>
  ${body}
</svg>
`;
}

function statCell(x, y, label, value) {
  return `<text class="text label" x="${x}" y="${y}">${escapeXml(label)}</text>
  <text class="text value" x="${x}" y="${y + 25}">${escapeXml(formatNumber(value))}</text>`;
}

function createStatsCard(user, repositories) {
  const stars = repositories.reduce((total, repo) => total + repo.stargazers_count, 0);
  const forks = repositories.reduce((total, repo) => total + repo.forks_count, 0);
  const body = `
  ${statCell(22, 86, "PUBLIC REPOS", repositories.length)}
  ${statCell(210, 86, "STARS EARNED", stars)}
  ${statCell(22, 139, "FOLLOWERS", user.followers)}
  ${statCell(210, 139, "FORKS", forks)}`;

  return cardShell("GITHUB SNAPSHOT", `@${username} / original public work`, body);
}

function createLanguagesCard(languageTotals) {
  const entries = Object.entries(languageTotals).sort((a, b) => b[1] - a[1]);
  const totalBytes = entries.reduce((total, [, bytes]) => total + bytes, 0);
  const topLanguages = entries.slice(0, 5);

  if (topLanguages.length === 0 || totalBytes === 0) {
    return cardShell(
      "LANGUAGE MIX",
      `@${username} / original public work`,
      '<text class="text" x="22" y="103" fill="#8b949e" font-size="13">No language data available yet.</text>',
    );
  }

  const rows = topLanguages
    .map(([language, bytes], index) => {
      const y = 78 + index * 21;
      const percent = (bytes / totalBytes) * 100;
      const width = Math.max(3, (percent / 100) * 185);
      const color = languageColors[language] || "#8b949e";

      return `<circle cx="27" cy="${y - 4}" r="4" fill="${color}"/>
  <text class="text" x="39" y="${y}" fill="#f0f6fc" font-size="12">${escapeXml(language)}</text>
  <rect x="145" y="${y - 11}" width="185" height="8" rx="4" fill="#21262d"/>
  <rect x="145" y="${y - 11}" width="${width.toFixed(1)}" height="8" rx="4" fill="${color}"/>
  <text class="text" x="378" y="${y}" fill="#8b949e" font-size="11" text-anchor="end">${percent.toFixed(1)}%</text>`;
    })
    .join("\n  ");

  return cardShell("LANGUAGE MIX", `@${username} / bytes across original public work`, rows);
}

async function main() {
  const [user, allRepositories] = await Promise.all([
    github(`/users/${encodeURIComponent(username)}`),
    getRepositories(),
  ]);

  const repositories = allRepositories.filter(
    (repo) => !repo.fork && !repo.archived && repo.size > 0,
  );

  const languageResponses = await Promise.all(
    repositories.map(async (repo) => {
      try {
        return await github(`/repos/${repo.full_name}/languages`);
      } catch (error) {
        console.warn(`Skipping language data for ${repo.full_name}: ${error.message}`);
        return {};
      }
    }),
  );

  const languageTotals = {};
  for (const languages of languageResponses) {
    for (const [language, bytes] of Object.entries(languages)) {
      languageTotals[language] = (languageTotals[language] || 0) + bytes;
    }
  }

  await mkdir("assets", { recursive: true });
  await Promise.all([
    writeFile("assets/github-stats.svg", createStatsCard(user, repositories), "utf8"),
    writeFile("assets/top-languages.svg", createLanguagesCard(languageTotals), "utf8"),
  ]);

  console.log(
    `Generated profile cards from ${repositories.length} repositories and ${Object.keys(languageTotals).length} languages.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
