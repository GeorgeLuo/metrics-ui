import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const EXAMPLES_ROOT = path.join(REPO_ROOT, "examples");

function walk(dir, matcher, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, matcher, acc);
      continue;
    }
    if (matcher(fullPath)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function toRepoPath(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function execGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readDateLines(args) {
  const output = execGit(args);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function statDate(repoPath) {
  const stats = fs.statSync(path.join(REPO_ROOT, repoPath));
  return new Date(stats.mtimeMs).toISOString().slice(0, 10);
}

function getFileHistoryDates(repoPath) {
  const history = readDateLines(["log", "--follow", "--format=%ad", "--date=short", "--", repoPath]);
  if (history.length === 0) {
    const fallback = statDate(repoPath);
    return { createdAt: fallback, updatedAt: fallback };
  }

  return {
    createdAt: history.at(-1),
    updatedAt: history[0],
  };
}

function findTopicObjectRange(lines, topicId) {
  const needle = `"id": "${topicId}"`;
  const idLineIndex = lines.findIndex((line) => line.includes(needle));
  if (idLineIndex < 0) {
    throw new Error(`Could not find topic id ${topicId}`);
  }

  let startIndex = idLineIndex;
  while (startIndex >= 0 && !lines[startIndex].trim().startsWith("{")) {
    startIndex -= 1;
  }
  if (startIndex < 0) {
    throw new Error(`Could not locate object start for topic ${topicId}`);
  }

  let depth = 0;
  let seenBrace = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        seenBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (seenBrace && depth === 0) {
      return { startLine: startIndex + 1, endLine: index + 1 };
    }
  }

  throw new Error(`Could not locate object end for topic ${topicId}`);
}

function parseLatestBlameDate(repoPath, startLine, endLine) {
  const output = execGit([
    "blame",
    "--line-porcelain",
    "-L",
    `${startLine},${endLine}`,
    "--",
    repoPath,
  ]);

  const times = output
    .split("\n")
    .filter((line) => line.startsWith("author-time "))
    .map((line) => Number.parseInt(line.slice("author-time ".length), 10))
    .filter((value) => Number.isFinite(value));

  if (times.length === 0) {
    return statDate(repoPath);
  }

  return new Date(Math.max(...times) * 1000).toISOString().slice(0, 10);
}

function parseCatalogEntryCreatedDate(repoPath, topicId) {
  const history = readDateLines([
    "log",
    "--reverse",
    "-S",
    `"id": "${topicId}"`,
    "--format=%ad",
    "--date=short",
    "--",
    repoPath,
  ]);

  return history[0] ?? statDate(repoPath);
}

function maxDate(...dates) {
  return dates
    .filter(Boolean)
    .sort()
    .at(-1);
}

function syncCatalogDates(catalogAbsPath) {
  const catalogRepoPath = toRepoPath(catalogAbsPath);
  const rawText = fs.readFileSync(catalogAbsPath, "utf8");
  const lines = rawText.split("\n");
  const catalog = JSON.parse(rawText);

  if (!Array.isArray(catalog.topics)) {
    throw new Error(`Catalog ${catalogRepoPath} is missing topics`);
  }

  const nextTopics = catalog.topics.map((topic) => {
    if (!topic || typeof topic !== "object" || typeof topic.id !== "string" || typeof topic.path !== "string") {
      throw new Error(`Catalog ${catalogRepoPath} has a malformed topic entry`);
    }

    const topicObjectRange = findTopicObjectRange(lines, topic.id);
    const catalogCreatedAt = parseCatalogEntryCreatedDate(catalogRepoPath, topic.id);
    const catalogUpdatedAt = parseLatestBlameDate(
      catalogRepoPath,
      topicObjectRange.startLine,
      topicObjectRange.endLine,
    );

    const artifactAbsPath = path.resolve(path.dirname(catalogAbsPath), topic.path);
    const artifactRepoPath = toRepoPath(artifactAbsPath);
    const artifactDates = getFileHistoryDates(artifactRepoPath);

    const createdAt = maxDate(catalogCreatedAt, artifactDates.createdAt);
    const updatedAt = maxDate(catalogUpdatedAt, artifactDates.updatedAt);

    return {
      id: topic.id,
      label: topic.label,
      description: topic.description,
      createdAt,
      updatedAt,
      sortKey: topic.sortKey ?? null,
      group: topic.group ?? null,
      tags: Array.isArray(topic.tags) ? topic.tags : [],
      searchTerms: Array.isArray(topic.searchTerms) ? topic.searchTerms : [],
      format: topic.format,
      path: topic.path,
    };
  });

  const nextCatalog = {
    id: catalog.id,
    label: catalog.label,
    description: catalog.description,
    topics: nextTopics,
  };

  fs.writeFileSync(catalogAbsPath, `${JSON.stringify(nextCatalog, null, 2)}\n`);
  return catalogRepoPath;
}

const catalogPaths = walk(EXAMPLES_ROOT, (absPath) => absPath.endsWith("equations-topic-catalog.json"));
if (catalogPaths.length === 0) {
  throw new Error("No equations topic catalogs found under examples/");
}

for (const catalogPath of catalogPaths) {
  const repoPath = syncCatalogDates(catalogPath);
  console.log(`Updated topic dates in ${repoPath}`);
}
