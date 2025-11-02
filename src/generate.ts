// src/generate.ts
// TypeScript; uses GitHub REST API and a tiny {{var}} templater (no deps)
import { readFile, writeFile } from "node:fs/promises";

type Repo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  archived: boolean;
  disabled: boolean;
};

type LanguageBreakdown = Record<string, number>;

type Cfg = {
  username: string;
  name: string;
  location: string;
  headline: string;
  featured: string[];
  stack_badges: string[];
};

const rawCfg = await readFile("./config.json", "utf8");
// assertion de type unique (sans double annotation)
const CFG = JSON.parse(rawCfg) as Cfg;

const GH = {
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  base: "https://api.github.com",
} as const;

async function gh(path: string): Promise<unknown> {
  const r = await fetch(`${GH.base}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(GH.token ? { Authorization: `Bearer ${GH.token}` } : {}),
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub API ${path} -> ${r.status}: ${txt}`);
  }
  return (await r.json()) as unknown;
}

async function listRepos(user: string): Promise<Repo[]> {
  // Fetch up to ~300 repos via pagination
  let page = 1;
  const all: Repo[] = [];
  while (page < 10) {
    const chunk = (await gh(
      `/users/${user}/repos?per_page=100&page=${page}&sort=updated`,
    )) as Repo[];
    all.push(...chunk);
    if (chunk.length < 100) break;
    page++;
  }
  return all.filter((r) => !r.archived && !r.disabled);
}

async function languagesForRepo(full: string): Promise<LanguageBreakdown> {
  try {
    return (await gh(`/repos/${full}/languages`)) as LanguageBreakdown;
  } catch {
    return {};
  }
}

function topN<T>(arr: T[], n: number, by: (x: T) => number): T[] {
  return [...arr].sort((a: T, b: T) => by(b) - by(a)).slice(0, n);
}

function percent(n: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((100 * n) / total)}%`;
}

function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);

  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

// Simple {{path.to.key}} renderer
function render(tpl: string, data: Record<string, unknown>): string {
  const re = /{{\s*([\w.]+)\s*}}/g;
  return tpl.replaceAll(re, (_: string, k: string) => {
    const value = k.split(".").reduce<unknown>((acc: unknown, key: string) => {
      return (acc as Record<string, unknown> | undefined)?.[key];
    }, data);
    return toText(value);
  });
}

function badge(label: string): string {
  // expects strings like "Java 21-ED8B00?logo=openjdk&logoColor=white"
  const parts = label.split("?");
  const left = parts[0] ?? "";
  const query = parts[1] ? "?" + parts[1] : "";
  return `https://img.shields.io/badge/${encodeURIComponent(left)}${query}`;
}

const nowParis = (): string =>
  new Date().toLocaleString("fr-FR", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });

async function main(): Promise<void> {
  const repos = await listRepos(CFG.username);
  const byStars = topN(repos, 6, (r: Repo) => r.stargazers_count);
  const featuredList =
    CFG.featured && CFG.featured.length > 0
      ? repos.filter((r: Repo) => CFG.featured.includes(r.full_name))
      : byStars;

  // language breakdown over top 20 active repos
  const forLang = topN(
    repos,
    20,
    (r: Repo) => r.stargazers_count + r.forks_count,
  );
  const langTotals: LanguageBreakdown = {};
  for (const r of forLang) {
    const langs = await languagesForRepo(r.full_name);
    // évite le cast : itère avec for..in
    for (const k in langs) {
      const v = langs[k] ?? 0;
      langTotals[k] = (langTotals[k] ?? 0) + v;
    }
  }
  const total = Object.values(langTotals).reduce(
    (a: number, b: number) => a + b,
    0,
  );
  const topLangs = Object.entries(langTotals)
    .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => ({ name: k, pct: percent(v, total) }));

  // Pre-render HTML fragments for the template (no nested template literals)
  const stack_badges_html = CFG.stack_badges
    .map((s) => {
      // Exemple d'entrée: "Java 21-ED8B00?logo=openjdk&logoColor=white"
      const alt = s.split("?")[0];          // "Java 21-ED8B00"
      const url = badge(s);                 // URL shields.io
      return `<img src="${url}" alt="${alt}" />`;
    })
    .join(" ");

  const featured_md = featuredList
    .map((r: Repo) => {
      const lineParts: string[] = [
        "- **[",
        r.name,
        "](",
        r.html_url,
        ")**",
        " · ⭐ ",
        String(r.stargazers_count),
        " · 🍴 ",
        String(r.forks_count),
      ];
      if (r.language) {
        lineParts.push(" · `", r.language, "`");
      }
      if (r.description) {
        lineParts.push(" — ", r.description);
      }
      return lineParts.join("");
    })
    .join("\n");

  const topLangs_cells = topLangs
    .map((l) => ["<td><b>", l.name, "</b><br/><sub>", l.pct, "</sub></td>"].join(""))
    .join("");

  const data = {
    name: CFG.name,
    username: CFG.username,
    location: CFG.location,
    headline: CFG.headline,
    updated: nowParis(),
    stack_badges_html,
    featured_md,
    topLangs_cells,
  };

  const template = await readFile("./templates/README.tpl.md", "utf8");
  const out = render(template, { data });
  await writeFile("README.md", out, "utf8");
  console.log("README.md generated.");
}

await main();
