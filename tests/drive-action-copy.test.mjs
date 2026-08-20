import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../apps/web/src/App.tsx", import.meta.url), "utf8");

test("assigned show action uses clear Check & Fix wording", () => {
  assert.match(appSource, /Check & Fix Drive Folders —/);
  assert.doesNotMatch(appSource, /Repair this show/);
});

test("busy state explains what is actually being checked", () => {
  assert.match(appSource, /Checking Drive folders…/);
  assert.doesNotMatch(appSource, /Working on this show…/);
});

test("unassigned Drive account still clearly means change storage assignment", () => {
  assert.match(appSource, /Use \$\{connection\.accountEmail \|\| \"Google Drive\"\} for this show/);
});

test("single-show operation keeps the no-other-show safety message", () => {
  assert.match(appSource, /No other show was changed\./);
  assert.match(appSource, /Show-level Check & Fix actions affect only the show whose card you clicked\./);
});

test("account-level action does not use repair language", () => {
  assert.match(appSource, /Check & prepare active shows/);
  assert.doesNotMatch(appSource, /Prepare \/ repair active shows/);
});
