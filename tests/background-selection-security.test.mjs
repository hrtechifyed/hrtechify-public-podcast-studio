import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../apps/worker/src/background-removal-api.ts", import.meta.url), "utf8");
const driveSource = await readFile(new URL("../apps/worker/src/google-drive-branding.ts", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../apps/web/src/ShowBrandingPanel.tsx", import.meta.url), "utf8");

test("selection API supports explicit GET and POST only", () => {
  assert.match(apiSource, /SELECTION_PATH = "\/api\/branding\/background-removal\/selection"/);
  assert.match(apiSource, /request\.method !== "GET" && request\.method !== "POST"/);
});

test("selection always validates the immutable original source first", () => {
  const sourceLoad = apiSource.indexOf("const source = await drive.getOwnedFile(show.id, show.name, sourceAssetId)");
  const sourceValidation = apiSource.indexOf("const sourceKind = sourceBrandAssetKind");
  const markerCreate = apiSource.indexOf("const selection = await createBrandSelectionMarker");
  assert.ok(sourceLoad >= 0);
  assert.ok(sourceValidation > sourceLoad);
  assert.ok(markerCreate > sourceValidation);
});

test("background-removed acceptance requires candidate to belong to the same source", () => {
  assert.match(apiSource, /candidate\.appProperties\.sourceAssetId !== source\.id/);
  assert.match(apiSource, /candidate\.appProperties\.sourceAssetKind !== sourceKind/);
  assert.match(apiSource, /background_candidate_source_mismatch/);
});

test("Keep Original selects the original ID and Accept selects only a validated candidate ID", () => {
  assert.match(apiSource, /let selectedAssetId = source\.id/);
  assert.match(apiSource, /selectedAssetId = candidate\.id/);
  assert.match(apiSource, /choice !== "original" && choice !== "background-removed"/);
});

test("selection history is append-only immutable JSON in Brand Assets", () => {
  assert.match(driveSource, /stateMarker: "true"/);
  assert.match(driveSource, /selectionChoice: input\.choice/);
  assert.match(driveSource, /selectedAssetId: input\.selectedAssetId/);
  assert.match(driveSource, /mimeType: "application\/json"/);
  assert.match(driveSource, /crypto\.randomUUID\(\)/);
  assert.match(driveSource, /immutable: "true"/);
  assert.doesNotMatch(driveSource, /method: "PATCH"/);
  assert.doesNotMatch(driveSource, /method: "DELETE"/);
});

test("latest selection is scoped to show, exact original source and selection kind", () => {
  assert.match(driveSource, /key='sourceAssetId' and value=/);
  assert.match(driveSource, /key='assetKind' and value=/);
  assert.match(driveSource, /orderBy", "createdTime desc"/);
  assert.match(driveSource, /pageSize", "1"/);
});

test("UI requires an explicit decision after preview", () => {
  assert.match(uiSource, />\s*Accept\s*</);
  assert.match(uiSource, />\s*Retry\s*</);
  assert.match(uiSource, />\s*Keep Original\s*</);
  assert.match(uiSource, /Nothing changes until you choose/);
  assert.match(uiSource, /setCandidate\(payload\)/);
  assert.doesNotMatch(uiSource, /setCandidate\(payload\)[\s\S]{0,120}selectBrandVersion/);
});

test("UI records selections using the selected show and Drive account", () => {
  assert.match(uiSource, /sourceAssetId: source\.id/);
  assert.match(uiSource, /choice,/);
  assert.match(uiSource, /candidateAssetId/);
  assert.match(uiSource, /showId,/);
  assert.match(uiSource, /connectionId,/);
  assert.match(uiSource, /credentials: "same-origin"/);
});
