/*
 * =================================================================================
 * NAC CLASSROOM MONITORING â€” OCR & SCHEDULING SYSTEM
 * =================================================================================
 * Google Apps Script bound to the NAC monitoring spreadsheet.
 *
 * Pipeline:
 *   1. Scan handwritten classroom-monitoring forms (images) dropped into the
 *      "Pending Scans" Drive folder.
 *   2. Send each image to Mistral's vision model to extract structured data
 *      (date, time, room, 8 Yes/No/Unclear answers, teacher, comment, inspector).
 *   3. Validate against the official room list and checker roster, flag anything
 *      unrecognized for human review, and skip exact duplicates.
 *   4. Append clean rows to the sheet, sort it, and rebuild monthly summary tabs
 *      with compliance charts.
 *
 * Setup: Project Settings â†’ Script Properties â†’ add MISTRAL_API_KEY.
 *
 * Duplicate rule: a record is a duplicate only if Date/Time, Room, all 8
 * answers, and the Comment match a row already on the sheet (buildRecordSignature_).
 *
 * Column layout: every column read or written anywhere in this file goes
 * through the COLUMNS map below â€” never a bare index â€” so the sheet layout
 * only ever needs to change in one place.
 * =================================================================================
 */
 
/* =========================================================================
 * CONFIGURATION
 * ========================================================================= */
 
const CONFIG = Object.freeze({
  BUILDING_NAME: 'NAC',
  MISTRAL_MODEL: 'pixtral-12b-2409',
  MISTRAL_ENDPOINT: 'https://api.mistral.ai/v1/chat/completions',
  OCR_TEMPERATURE: 0.1,
  OCR_MAX_RETRIES: 5,
  MAX_FILES_PER_BATCH: 10,
  RUN_TIME_BUDGET_MS: 4 * 60 * 1000,
  THROTTLE_MS: 1500,
  TARGET_YEAR_FULL: 2026,
  TARGET_YEAR_SHORT: '26',
  MAX_SCORE_PER_AUDIT: 80,
  MAX_ROOM_RANGE_SPAN: 25,
  OCR_FIELD_CONFIDENCE_THRESHOLD: 0.75,
  OCR_MATCH_MARGIN_THRESHOLD: 0.08,
  INSPECTOR_MATCH_THRESHOLD: 0.8,
  INSPECTOR_MATCH_MARGIN_THRESHOLD: 0.08,
  ROOM_MATCH_THRESHOLD: 0.85,
  ROOM_MATCH_MARGIN_THRESHOLD: 0.08,
  FOLDER_NAMES: Object.freeze({ ROOT: 'NAC Reports', PENDING: 'Pending Scans', PROCESSED: 'Processed Scans', REVIEW: 'Needs Review', DUPLICATE: 'Duplicate Scans', FAILED: 'Failed Scans' }),
  RUN_LOG_SHEET_NAME: 'ðŸ“Š NAC Run Log',
  OFFICIAL_ROOMS: Object.freeze([
  "103", "104", "201", "202", "203", "204", "305", "306", 
  "307", "401", "402", "403", "404", "405", "505", "506", "507"
]),
  OFFICIAL_CHECKERS: Object.freeze([
  "ABELLANO", "ABSIN", "AMPLAYO", "ARIZA", "BABAO", "BACUS", 
  "BALICAO", "BASLOT", "BERMOY", "BUNGALON", "CENA", "EBABACOL", 
  "ELLO", "GAAN", "GUANGCO", "LIM", "LOMONSOD", "LOMONSOI", 
  "NOYNAY", "PACUIN", "PIMPING", "RAZALO", "TALLE"
])
});

const NAC_CHECKER_SCHEDULE = Object.freeze([
    { day: 'MONDAY', slots: [
    { time: '7:30-12:00', assigned: 'BABAO', partner: 'ARIZA' },
    { time: '1:00-5:00', assigned: 'WLA ASSING ', partner: '' }
  ] },
  { day: 'TUESDAY', slots: [
    { time: '7:30-12:00', assigned: 'BABAO', partner: 'AMPLAYO' },
    { time: '1:00-5:00', assigned: 'AMPLAYO', partner: '' }
  ] },
  { day: 'WEDNESDAY', slots: [
    { time: '7:30-10:30', assigned: 'BABAO', partner: '' },
    { time: '1:00-2:00', assigned: 'ARIZA', partner: 'BASLOT' },
    { time: '2:00-3:00', assigned: 'BASOT', partner: '' },
     { time: '3:00-5:00', assigned: 'BABAO', partner: 'BASLOT' }
  ] },
  { day: 'THURSDAY', slots: [
    { time: '7:30-12:00', assigned: 'ARIZA', partner: '' },
    { time: '1:00-5:00', assigned: 'ARIZA', partner: '' }
  ] },
  { day: 'FRIDAY', slots: [
    { time: '7:30-11:00', assigned: 'APLAYO', partner: '' },
    { time: '11:00-12:00', assigned: 'BABAO', partner: 'AMPLAYO' },
    { time: '1:00-5:00', assigned: 'BABAO', partner: 'AMPLAYO' }
  ] },
  { day: 'SATURDAY', slots: [
    { time: '7:30-12:00', assigned: 'BABAO', partner: '' }
  ] }
]);
/* =========================================================================
 * SHEET COLUMN LAYOUT â€” the single source of truth.
 * Every function that reads or writes a column uses these names, never a
 * bare index, so re-ordering columns only ever requires editing this block.
 * ========================================================================= */
 
const COLUMNS = Object.freeze({
  TIMESTAMP: 0,
  SCORE: 1,
  DATE_TIME: 2,
  CAMPUS: 3,
  ROOM: 4,
  Q1: 5,
  Q2: 6,
  Q3: 7,
  Q4: 8,
  Q5: 9,
  Q6: 10,
  Q7_TEACHER: 11,
  TEACHER_NAME: 12,
  Q8: 13,
  COMMENTS: 14,
  INSPECTOR: 15,
  TOTAL_YES: 16,
  TOTAL_NO: 17,
  FILE_NAME: 18,
  STATUS: 19
});
 
// Header text for row 1, populated by COLUMNS index so it can never drift
// out of sync with the map above.
const HEADERS = [];
HEADERS[COLUMNS.TIMESTAMP] = 'Timestamp';
HEADERS[COLUMNS.SCORE] = 'Score';
HEADERS[COLUMNS.DATE_TIME] = 'Date/Time';
HEADERS[COLUMNS.CAMPUS] = 'Campus';
HEADERS[COLUMNS.ROOM] = 'Room';
HEADERS[COLUMNS.Q1] = 'Q1';
HEADERS[COLUMNS.Q2] = 'Q2';
HEADERS[COLUMNS.Q3] = 'Q3';
HEADERS[COLUMNS.Q4] = 'Q4';
HEADERS[COLUMNS.Q5] = 'Q5';
HEADERS[COLUMNS.Q6] = 'Q6';
HEADERS[COLUMNS.Q7_TEACHER] = 'Q7 (Teacher)';
HEADERS[COLUMNS.TEACHER_NAME] = 'Teacher Name';
HEADERS[COLUMNS.Q8] = 'Q8';
HEADERS[COLUMNS.COMMENTS] = 'Comments';
HEADERS[COLUMNS.INSPECTOR] = 'Inspector';
HEADERS[COLUMNS.TOTAL_YES] = 'Total Yes';
HEADERS[COLUMNS.TOTAL_NO] = 'Total No';
HEADERS[COLUMNS.FILE_NAME] = 'File Name';
HEADERS[COLUMNS.STATUS] = 'Status / Review Reason';
Object.freeze(HEADERS);
 
/* =========================================================================
 * WEEKLY CHECKER SCHEDULE â€” used to auto-fill the inspector when a form
 * arrives without one (see readNACFormFromImage_).
 * ========================================================================= */
 
const NAC_SCHEDULE = Object.freeze([
  { day: 'MONDAY', slots: [
    { time: '7:30-12:00', assigned: 'BABAO', partner: 'ARIZA' },
    { time: '1:00-5:00', assigned: 'WLA ASSING ', partner: '' }
  ] },
  { day: 'TUESDAY', slots: [
    { time: '7:30-12:00', assigned: 'BABAO', partner: 'AMPLAYO' },
    { time: '1:00-5:00', assigned: 'AMPLAYO', partner: '' }
  ] },
  { day: 'WEDNESDAY', slots: [
    { time: '7:30-10:30', assigned: 'BABAO', partner: '' },
    { time: '1:00-2:00', assigned: 'ARIZA', partner: 'BASLOT' },
    { time: '2:00-3:00', assigned: 'BASOT', partner: '' },
     { time: '3:00-5:00', assigned: 'BABAO', partner: 'BASLOT' }
  ] },
  { day: 'THURSDAY', slots: [
    { time: '7:30-12:00', assigned: 'ARIZA', partner: '' },
    { time: '1:00-5:00', assigned: 'ARIZA', partner: '' }
  ] },
  { day: 'FRIDAY', slots: [
    { time: '7:30-11:00', assigned: 'APLAYO', partner: '' },
    { time: '11:00-12:00', assigned: 'BABAO', partner: 'AMPLAYO' },
    { time: '1:00-5:00', assigned: 'BABAO', partner: 'AMPLAYO' }
  ] },
  { day: 'SATURDAY', slots: [
    { time: '7:30-12:00', assigned: 'BABAO', partner: '' }
  ] }
]);
 
/* =========================================================================
 * MENU
 * ========================================================================= */
 
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ðŸ“‹ NAC Tools')
    .addItem('Scan Pending NAC Reports', 'scanNACPaperReports')
    .addItem('â° Install Hourly Auto-Trigger', 'setupTimeDrivenTrigger')
    .addItem('Sort Sheet Now', 'sortNACSheetNow')
    .addItem('ðŸ—‘ï¸ Remove All Row Plus Buttons', 'removeAllRowGroupsNow')
    .addItem('ðŸ“Š Clean Existing Room Numbers', 'cleanExistingRoomsInSheet')
    .addItem('ðŸ“Š Generate Monthly Summaries & Charts', 'generateNACSummaryNow')
    .addItem('ðŸŽ¨ Format Header Row Green', 'formatHeaderGreenNow')
    .addToUi();
}
 
function removeAllRowGroupsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getMainSheet(ss);
  if (!sheet) return;
 
  removeAllRowGroups(sheet);
  ss.toast("All row groups and '+' buttons removed permanently.", 'NAC Tools', 3);
}
 
function setupTimeDrivenTrigger() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'scanNACPaperReports') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
 
  ScriptApp.newTrigger('scanNACPaperReports').timeBased().everyHours(1).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('1M trigger installed for NAC scans.', 'NAC Tools', 5);
}
 
function formatHeaderGreenNow() {
  styleHeaderRowGreen(SpreadsheetApp.getActiveSheet());
}
 
function cleanExistingRoomsInSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getMainSheet(ss);
  if (!sheet || sheet.getLastRow() <= 1) return;
 
  const lastRow = sheet.getLastRow();
  const roomRange = sheet.getRange(2, COLUMNS.ROOM + 1, lastRow - 1, 1);
  const values = roomRange.getValues();
 
  for (let i = 0; i < values.length; i++) {
    if (values[i][0]) values[i][0] = extractPureRoomNumber(values[i][0]);
  }
 
  roomRange.setNumberFormat('@').setValues(values);
  SpreadsheetApp.flush();
}
 
function sortNACSheetNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getMainSheet(ss);
  if (!sheet) return;
 
  sortSheetByRoomNumber(sheet);
  styleHeaderRowGreen(sheet);
  ss.toast('NAC Sheet sorted.', 'NAC Tools', 3);
}
 
/* =========================================================================
 * MAIN PROCESSOR
 * ========================================================================= */
 
/**
 * Scans every image in "Pending Scans", extracts its data with Mistral OCR,
 * appends validated rows to the sheet, and files each source image into
 * Processed / Needs Review / Duplicate / Failed. Safe to re-run (e.g. via
 * the hourly trigger) â€” already-handled files have moved out of the pending
 * folder and won't be seen again.
 */
function scanNACPaperReports() {
  const startTime = Date.now();
  const folders = getNacFolders_();
 
  const apiKey = PropertiesService.getScriptProperties().getProperty('MISTRAL_API_KEY');
  if (!apiKey) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Missing MISTRAL_API_KEY', 'NAC Error', 10);
    return;
  }
 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getMainSheet(ss);
  ensureMinColumns(sheet, HEADERS.length);
  ensureSheetHeadersNAC(sheet);
 
  const existingSignatures = loadExistingSignatures_(sheet);
  const pendingFiles = getPendingFilesSorted_(folders.pending);
  const tally = { processed: 0, review: 0, duplicate: 0, error: 0 };
 
  for (let i = 0; i < pendingFiles.length; i++) {
    const filesHandled = tally.processed + tally.review + tally.duplicate + tally.error;
    if (filesHandled >= CONFIG.MAX_FILES_PER_BATCH) break;
    if (Date.now() - startTime >= CONFIG.RUN_TIME_BUDGET_MS) break;
 
    const file = pendingFiles[i];
 
    if (file.getMimeType().indexOf('image/') !== 0) {
      safeMoveTo_(file, folders.error);
      tally.error++;
      continue; // not something we can OCR â€” skip the throttle delay too
    }
 
    const outcome = processSingleFile_(file, { sheet, apiKey, existingSignatures, folders });
    tally[outcome]++;
    Utilities.sleep(CONFIG.THROTTLE_MS);
  }
 
  finalizeNACRun_(ss, sheet, tally, startTime);
}
 
/**
 * Handles one *image* file end-to-end: OCR â†’ validate â†’ append â†’ file the
 * source image into the right output folder.
 * @return {'processed'|'review'|'duplicate'|'error'}
 */
function processSingleFile_(file, ctx) {
  const { sheet, apiKey, existingSignatures, folders } = ctx;
  const fileName = file.getName();
 
  try {
    const parsed = readNACFormFromImage_(file, apiKey);
    const { appendedAny, needsReview } = appendParsedRoomsToSheet_(parsed, fileName, sheet, existingSignatures);
 
    if (!appendedAny) {
      safeMoveTo_(file, folders.duplicate);
      return 'duplicate';
    }
 
    safeMoveTo_(file, needsReview ? folders.review : folders.processed);
    return needsReview ? 'review' : 'processed';
 
  } catch (err) {
    console.error('NAC scan failed for "' + fileName + '":', err);
    safeMoveTo_(file, folders.error);
    return 'error';
  }
}
 
/**
 * Runs OCR on one image and applies the rules that don't depend on a
 * specific room: year lockdown, future-date guard, and auto-filling the
 * inspector from the weekly schedule when the form didn't name one.
 */
function readNACFormFromImage_(file, apiKey) {
  const blob = file.getBlob().getAs('image/jpeg');
  let parsed = extractFormDataWithMistral(blob, blob.getContentType(), apiKey);

  const parsedFieldInfo = normalizeParsedFieldTree_(parsed);
  parsed = { ...parsed, ...parsedFieldInfo };

  const criticalFields = ['room', 'inspector', 'date', 'teacher_name'];
  const needsSecondPass = criticalFields.some((fieldName) => fieldConfidence_(parsed[fieldName], fieldName) < CONFIG.OCR_FIELD_CONFIDENCE_THRESHOLD);

  if (needsSecondPass) {
    const secondPass = extractRecheckWithMistral_(blob, blob.getContentType(), apiKey, parsed);
    if (secondPass) {
      const secondFieldInfo = normalizeParsedFieldTree_(secondPass);
      parsed = mergeCriticalFieldReads_(parsed, secondFieldInfo);
    }
  }

  parsed.campus = CONFIG.BUILDING_NAME;
  const originalDateMissing = !parsed.date || String(parsed.date).trim() === '';
  const dateCandidate = parsed.dateInfo && parsed.dateInfo.normalized ? parsed.dateInfo.normalized : parsed.date;
  parsed.date = enforceTargetYear(dateCandidate);
  parsed.dateMissing = originalDateMissing || !dateCandidate;

  if (isFutureMonth(parsed.date)) {
    throw new Error('OCR produced an impossible future month (' + parsed.date + '). Skipped to avoid bad data.');
  }

  const inspectorRaw = parsed.inspectorInfo ? parsed.inspectorInfo.raw : parsed.inspector;
  const hasRecognizableInspector = !!(inspectorRaw && inspectorRaw.trim() && getOfficialInspector(inspectorRaw) !== 'UNKNOWN');
  if (!hasRecognizableInspector) {
    const scheduled = lookupNACScheduledChecker(parsed.date);
    if (scheduled) {
      parsed.inspector = scheduled + ' (Auto-filled)';
      parsed.inspectorInfo = { raw: parsed.inspector, normalized: scheduled, confidence: 0.8 };
    }
  } else {
    parsed.inspector = inspectorRaw;
  }

  return parsed;
}
 
/**
 * Expands the parsed room (which may be a range like "301-305") into one
 * row per room, skipping any row whose data signature already exists.
 * @return {{appendedAny: boolean, needsReview: boolean}}
 */
function appendParsedRoomsToSheet_(parsed, fileName, sheet, existingSignatures) {
  const officialInspector = getOfficialInspector(parsed.inspector);
  const rooms = expandRoomRangeNAC(parsed.room);
 
  let appendedAny = false;
  let needsReview = false;
 
  const rowsToAppend = [];
  const sheetLastRow = sheet.getLastRow();

  rooms.forEach((rawRoom) => {
    const officialRoom = getOfficialRoom(rawRoom);
    const reviewReason = checkNeedsReview(parsed, officialRoom, officialInspector, parsed.room);
    const rowData = buildRowData(parsed, fileName, reviewReason, officialRoom, officialInspector);
    const signature = buildRecordSignature_(rowData);

    if (existingSignatures.has(signature)) return; // identical record already on the sheet

    existingSignatures.add(signature);
    rowsToAppend.push(rowData);
    appendedAny = true;
    if (reviewReason) needsReview = true;
  });

  if (rowsToAppend.length) {
    sheet.getRange(sheetLastRow + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }

  SpreadsheetApp.flush();
  return { appendedAny, needsReview };
}
 
/** Sorts/styles the sheet, rebuilds summary tabs, and logs the run. Never throws. */
function finalizeNACRun_(ss, sheet, tally, startTime) {
  try {
    sortSheetByRoomNumber(sheet);
    styleHeaderRowGreen(sheet);
  } catch (err) {
    console.error('Post-scan sort/style failed:', err);
  }
 
  try {
    generateNACSummary(ss, sheet);
    ss.toast('âœ… NAC summaries created on new tabs.', 'Summary', 5);
  } catch (err) {
    ss.toast('âŒ Summary generation failed: ' + err, 'Error', 10);
  }
 
  const runtimeSeconds = Math.round((Date.now() - startTime) / 1000);
  addLogEntry(ss, tally.processed, tally.review, tally.duplicate, tally.error, runtimeSeconds);
  ss.toast(
    'NAC Done. P:' + tally.processed + ' R:' + tally.review + ' D:' + tally.duplicate + ' E:' + tally.error,
    'Scan Complete',
    5
  );
}
 
/** Creates (if needed) and returns the NAC Reports folder tree. */
function getNacFolders_() {
  const root = DriveApp.getRootFolder();
  const building = getOrCreateFolder(root, CONFIG.FOLDER_NAMES.ROOT);
 
  return {
    building: building,
    pending: getOrCreateFolder(building, CONFIG.FOLDER_NAMES.PENDING),
    processed: getOrCreateFolder(building, CONFIG.FOLDER_NAMES.PROCESSED),
    review: getOrCreateFolder(building, CONFIG.FOLDER_NAMES.REVIEW),
    duplicate: getOrCreateFolder(building, CONFIG.FOLDER_NAMES.DUPLICATE),
    error: getOrCreateFolder(building, CONFIG.FOLDER_NAMES.FAILED)
  };
}
 
/** Builds the set of data signatures already present on the sheet (see buildRecordSignature_). */
function loadExistingSignatures_(sheet) {
  const signatures = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return signatures;
 
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  data.forEach((row) => signatures.add(buildRecordSignature_(row)));
  return signatures;
}
 
/** Returns every file in the pending folder, sorted by name for deterministic runs. */
function getPendingFilesSorted_(pendingFolder) {
  const iterator = pendingFolder.getFiles();
  const files = [];
  while (iterator.hasNext()) files.push(iterator.next());
 
  files.sort((a, b) => a.getName().localeCompare(b.getName()));
  return files;
}
 
/** file.moveTo() that logs instead of throwing, so one bad move can't abort the batch. */
function safeMoveTo_(file, destinationFolder) {
  try {
    file.moveTo(destinationFolder);
  } catch (err) {
    console.error('Could not move file "' + file.getName() + '":', err);
  }
}
 
/* =========================================================================
 * OCR (Mistral)
 * ========================================================================= */
 
/**
 * Sends one image to Mistral and returns the normalized form object.
 * This parser accepts partial or sparse form responses and never rejects a
 * scan solely because a field or question is missing.
 */
function extractFormDataWithMistral(blob, mimeType, apiKey) {
  const payload = buildMistralPayload_(blob, mimeType, false);
  const content = callMistralWithRetry_(payload, apiKey);
  const parsed = parseMistralResponseObject_(content);
  return normalizeParsedFieldTree_(parsed || {});
}

function extractRecheckWithMistral_(blob, mimeType, apiKey, previousParsed) {
  const payload = buildMistralPayload_(blob, mimeType, true, previousParsed);
  const content = callMistralWithRetry_(payload, apiKey);
  const parsed = parseMistralResponseObject_(content);
  if (!parsed || typeof parsed !== 'object') return null;
  return normalizeParsedFieldTree_(parsed);
}

function parseMistralResponseObject_(content) {
  if (!content) return null;

  let text = String(content).trim();
  if (!text) return null;

  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

function extractQuestionAnswerValue_(entry) {
  if (entry == null) return 'Unclear';
  if (typeof entry === 'object') {
    if (entry.response != null) return extractQuestionAnswerValue_(entry.response);
    if (entry.answer != null) return extractQuestionAnswerValue_(entry.answer);
    if (entry.value != null) return extractQuestionAnswerValue_(entry.value);
    if (entry.raw != null) return extractQuestionAnswerValue_(entry.raw);
    if (entry.normalized != null) return extractQuestionAnswerValue_(entry.normalized);
    return 'Unclear';
  }

  const value = String(entry).trim();
  if (!value) return 'Unclear';
  const lower = value.toLowerCase();
  if (['yes', 'y', 'true', '1'].indexOf(lower) !== -1) return 'Yes';
  if (['no', 'n', 'false', '0'].indexOf(lower) !== -1) return 'No';
  if (['unclear', 'unknown', 'blank', 'missing', 'na', 'n/a', '-', ''].indexOf(lower) !== -1) return 'Unclear';
  if (lower.indexOf('yes') === 0) return 'Yes';
  if (lower.indexOf('no') === 0) return 'No';
  return 'Unclear';
}

function normalizeQuestionAnswerList_(answers) {
  const safeList = Array.isArray(answers) ? answers : [];
  const normalized = Array(8).fill('Unclear');

  for (let i = 0; i < Math.min(safeList.length, 8); i++) {
    normalized[i] = extractQuestionAnswerValue_(safeList[i]);
  }

  return normalized;
}

function extractFieldCandidate_(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (obj[key] != null && obj[key] !== '') return obj[key];
  }

  return '';
}

function normalizeFieldValue_(value, fallbackValue) {
  if (value === null || value === undefined || value === '') {
    return { raw: String(fallbackValue || ''), normalized: String(fallbackValue || ''), confidence: 0 };
  }

  if (typeof value === 'object') {
    const rawValue = value.raw != null ? value.raw : (value.value != null ? value.value : (value.normalized != null ? value.normalized : (value.response != null ? value.response : fallbackValue)));
    const normalizedValue = value.normalized != null ? value.normalized : rawValue;
    const confidence = Number(value.confidence || 0);
    return {
      raw: String(rawValue ?? ''),
      normalized: String(normalizedValue ?? ''),
      confidence: isNaN(confidence) ? 0 : confidence
    };
  }

  const raw = String(value);
  return { raw, normalized: raw, confidence: 0 };
}

function buildMistralPayload_(blob, mimeType, isRecheck, previousParsed) {
  const dataUrl = 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes());

  return {
    model: CONFIG.MISTRAL_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildOcrPrompt_(isRecheck, previousParsed) },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }],
    response_format: { type: 'json_object' },
    temperature: CONFIG.OCR_TEMPERATURE
  };
}

function buildOcrPrompt_(isRecheck, previousParsed) {
  const instructions = [
    'You are reading a structured handwritten classroom inspection form.',
    'Inspect the whole page before deciding. Look at the printed labels and then the handwritten entry in each field.',
    'This is not blank or low-quality text; the handwriting is usually readable but may contain normal handwritten variations.',
    'Read each field carefully using its position on the form. Separate printed labels from handwriting, and separate one field from the next.',
    'Avoid assuming a character is unreadable. Compare visually similar characters, especially: O/0, 1/I/l, 2/Z, 3/8, 5/S, 6/G, 7/T/1, 8/B, 9/g.',
    'Treat missing spaces, extra spaces, dashes, slashes, faint strokes, camera perspective, shadows, and slight tilt as normal handwriting variation.',
    'Return the best raw reading for each field and include your confidence estimate. If a field is missing or unclear, return an empty string or "Unclear" and do not invent information.',
    'Important: room and inspector are critical fields. They must be read as handwriting candidates first, then normalized against the official lists. Do not directly invent a final official room or official name.',
    'Date format must be MM-DD-YY or a clear date candidate. If you see a handwritten 7/13/26 or 07/13/26, keep the date as a readable raw value and let the validation layer normalize it.',
    'Room can be a number or a short descriptive label. The exact value is less important than finding the correct official room later.',
    'Answers may be partial; if some questions are missing, keep the JSON sparse and leave the missing ones as empty strings or "Unclear". Do not fail the whole form.',
    'Output JSON with the form fields you can safely read. Missing optional fields are allowed and must not cause an error.'
  ];

  if (isRecheck && previousParsed) {
    instructions.push('SECOND PASS ONLY: Re-examine only the ambiguous fields: room number, inspector, date, and teacher name. Do not repeat the first answer blindly. Re-check the handwriting for skew, loops, and similar-looking characters before finalizing.');
    instructions.push('Previous raw reading: ' + JSON.stringify({
      date: previousParsed.dateInfo || previousParsed.date,
      room: previousParsed.roomInfo || previousParsed.room,
      inspector: previousParsed.inspectorInfo || previousParsed.inspector,
      teacher_name: previousParsed.teacherInfo || previousParsed.teacher_name
    }));
  }

  return instructions.join('\n');
}

function normalizeParsedFieldTree_(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const out = Object.assign({}, source);

  const answerList = normalizeQuestionAnswerList_(source.answers || source.questions || []);
  out.answers = answerList;

  const dateValue = extractFieldCandidate_(source, ['date', 'dateInfo', 'inspection_date', 'inspectionDate']);
  const timeValue = extractFieldCandidate_(source, ['time', 'timeInfo', 'inspection_time', 'inspectionTime']);
  const roomValue = extractFieldCandidate_(source, ['room', 'roomInfo', 'room_number', 'roomNumber']);
  const teacherValue = extractFieldCandidate_(source, ['teacher_name', 'teacherName', 'teacher', 'teacherInfo']);
  const inspectorValue = extractFieldCandidate_(source, ['inspector', 'inspectorInfo', 'checker', 'checkerName']);
  const commentValue = extractFieldCandidate_(source, ['comment', 'comments', 'commentInfo']);

  out.dateInfo = normalizeFieldValue_(dateValue, '');
  out.timeInfo = normalizeFieldValue_(timeValue, '');
  out.roomInfo = normalizeFieldValue_(roomValue, '');
  out.teacherInfo = normalizeFieldValue_(teacherValue, '');
  out.inspectorInfo = normalizeFieldValue_(inspectorValue, '');
  out.commentInfo = normalizeFieldValue_(commentValue, '');

  out.date = out.dateInfo.normalized || out.dateInfo.raw || '';
  out.time = out.timeInfo.normalized || out.timeInfo.raw || '';
  out.room = out.roomInfo.normalized || out.roomInfo.raw || '';
  out.teacher_name = out.teacherInfo.normalized || out.teacherInfo.raw || '';
  out.inspector = out.inspectorInfo.normalized || out.inspectorInfo.raw || '';
  out.comment = out.commentInfo.normalized || out.commentInfo.raw || '';

  if (source.teacherName && !out.teacher_name) out.teacher_name = String(source.teacherName).trim();
  if (source.teacher_name && !out.teacher_name) out.teacher_name = String(source.teacher_name).trim();
  if (source.comment && !out.comment) out.comment = String(source.comment).trim();
  if (source.inspector && !out.inspector) out.inspector = String(source.inspector).trim();

  return out;
}

function mergeCriticalFieldReads_(primary, secondary) {
  const out = Object.assign({}, primary || {});
  const keys = ['date', 'room', 'inspector', 'teacher_name'];

  keys.forEach((key) => {
    const primaryInfo = out[key + 'Info'] || { raw: out[key] || '', normalized: out[key] || '', confidence: 0 };
    const secondaryInfo = secondary && secondary[key + 'Info'] ? secondary[key + 'Info'] : { raw: secondary && secondary[key] ? secondary[key] : '', normalized: secondary && secondary[key] ? secondary[key] : '', confidence: 0 };

    const shouldUseSecondary = !primaryInfo.raw || (secondaryInfo.confidence > primaryInfo.confidence) || (secondaryInfo.raw && !primaryInfo.normalized && !primaryInfo.raw);

    if (shouldUseSecondary && secondaryInfo.raw) {
      out[key + 'Info'] = secondaryInfo;
      out[key] = secondaryInfo.normalized || secondaryInfo.raw || out[key];
    }
  });

  return out;
}

function fieldConfidence_(info, fieldName) {
  if (!info) return 0;

  if (typeof info === 'object' && info.confidence != null) {
    return Number(info.confidence) || 0;
  }

  const raw = String(info || '').trim();
  if (!raw) return 0;
  if (fieldName === 'room') return raw.length > 2 ? 0.72 : 0.5;
  if (fieldName === 'inspector') return raw.length > 2 ? 0.72 : 0.5;
  if (fieldName === 'date') return /\d/.test(raw) ? 0.7 : 0.4;
  return 0.65;
}

function callMistralWithRetry_(payload, apiKey) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const maxAttempts = Math.min(Number(CONFIG.OCR_MAX_RETRIES) || 3, 3);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = UrlFetchApp.fetch(CONFIG.MISTRAL_ENDPOINT, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if ([429, 500, 502, 503, 504].indexOf(responseCode) !== -1) {
        if (attempt < maxAttempts - 1) {
          Utilities.sleep(Math.min(500 + attempt * 500, 2000));
          continue;
        }
        throw new Error('Mistral rate limit reached. Please retry later.');
      }

      if (responseCode !== 200) {
        throw new Error('Mistral error (' + responseCode + '): ' + responseText);
      }

      const data = JSON.parse(responseText);
      if (!data || !Array.isArray(data.choices) || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        throw new Error('Mistral returned an unexpected response structure.');
      }

      return data.choices[0].message.content
        .trim()
        .replace(/^`{3}(?:json)?\s*/i, '')
        .replace(/\s*`{3}$/, '')
        .trim();
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      const transient = /429|timeout|temporar|rate limit|500|502|503|504/i.test(message);
      if (attempt < maxAttempts - 1 && transient) {
        Utilities.sleep(Math.min(500 + attempt * 500, 2000));
        continue;
      }
      throw new Error('Mistral request failed: ' + message);
    }
  }

  throw new Error('Mistral rate-limit retries exhausted.');
}
 
/** Calls the Mistral endpoint, retrying with exponential backoff on HTTP 429. */
function callMistralWithRetry_(payload, apiKey) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (let attempt = 0; attempt < CONFIG.OCR_MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch(CONFIG.MISTRAL_ENDPOINT, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if ([429, 500, 502, 503, 504].indexOf(responseCode) !== -1) {
        Utilities.sleep(Math.min(Math.pow(2, attempt) * 1000, 16000));
        continue;
      }

      if (responseCode !== 200) {
        throw new Error('Mistral error (' + responseCode + '): ' + responseText);
      }

      const data = JSON.parse(responseText);
      if (!data || !Array.isArray(data.choices) || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        throw new Error('Mistral returned an unexpected response structure.');
      }

      return data.choices[0].message.content
        .trim()
        .replace(/^`{3}(?:json)?\s*/i, '')
        .replace(/\s*`{3}$/, '')
        .trim();
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      const transient = /429|timeout|temporar|rate limit|500|502|503|504/i.test(message);
      if (attempt < CONFIG.OCR_MAX_RETRIES - 1 && transient) {
        Utilities.sleep(Math.min(Math.pow(2, attempt) * 1000, 16000));
        continue;
      }
      throw new Error('Mistral request failed: ' + message);
    }
  }

  throw new Error('Mistral rate-limit retries exhausted.');
}
 
/* =========================================================================
 * STRICT MAPPING â€” rooms & inspectors
 * Anything that doesn't match the official lists comes back as "UNKNOWN"
 * and gets flagged for review by checkNeedsReview.
 * ========================================================================= */
 
/** Matches by the numeric part only, so "104" matches the official "104 chem 1". */
function getOfficialRoom(roomStr) {
  if (!roomStr) return 'UNKNOWN';

  const input = normalizeRoomCandidate_(roomStr);
  if (!input) return 'UNKNOWN';

  const candidates = CONFIG.OFFICIAL_ROOMS;
  const normalizedInput = String(input).trim();
  const inputDigits = extractDigits_(normalizedInput);

  const scored = candidates.map((official) => {
    const officialDigits = extractDigits_(official);
    const numericScore = inputDigits ? similarity_(inputDigits, officialDigits) : 0;
    const labelScore = similarity_(normalizedInput.toUpperCase(), String(official).toUpperCase());
    const score = Math.max(numericScore, labelScore);
    return { cand: official, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0] || { cand: null, score: 0 };
  const second = scored[1] || { cand: null, score: 0 };

  if (!best.cand || best.score < CONFIG.ROOM_MATCH_THRESHOLD) return 'UNKNOWN';
  if (second && (best.score - second.score) < CONFIG.ROOM_MATCH_MARGIN_THRESHOLD) return 'UNKNOWN';

  return extractDigits_(best.cand);
}

/** Matches exact or fuzzy inspector names against the official checker roster. */
function getOfficialInspector(inspectorStr) {
  if (!inspectorStr) return 'UNKNOWN';

  const clean = String(inspectorStr).trim();
  const upper = clean.toUpperCase();
  if (upper.indexOf('AUTO-FILLED') !== -1) {
    return inspectorStr;
  }

  const exact = CONFIG.OFFICIAL_CHECKERS.find((checker) => normalizeInspectorForMatch_(upper).indexOf(normalizeInspectorForMatch_(checker)) !== -1);
  if (exact) return exact;

  const scored = CONFIG.OFFICIAL_CHECKERS.map((checker) => ({
    cand: checker,
    score: similarity_(normalizeInspectorForMatch_(upper), normalizeInspectorForMatch_(checker))
  })).sort((a, b) => b.score - a.score);

  const best = scored[0] || { cand: null, score: 0 };
  const second = scored[1] || { cand: null, score: 0 };

  if (!best.cand || best.score < CONFIG.INSPECTOR_MATCH_THRESHOLD) return 'UNKNOWN';
  if (second && (best.score - second.score) < CONFIG.INSPECTOR_MATCH_MARGIN_THRESHOLD) return 'UNKNOWN';

  return best.cand;
}

function getInspectorMatchDetails(inspectorStr) {
  const clean = String(inspectorStr || '').trim();
  if (!clean) return { match: null, score: 0, secondBest: null, margin: 0 };
  if (clean.toUpperCase().indexOf('AUTO-FILLED') !== -1) return { match: inspectorStr, score: 1, secondBest: null, margin: 1 };

  const scored = CONFIG.OFFICIAL_CHECKERS.map((checker) => ({
    cand: checker,
    score: similarity_(normalizeInspectorForMatch_(clean), normalizeInspectorForMatch_(checker))
  })).sort((a, b) => b.score - a.score);

  const best = scored[0] || { cand: null, score: 0 };
  const second = scored[1] || { cand: null, score: 0 };
  const margin = best.score - second.score;

  return { match: best.cand, score: best.score, secondBest: second.cand, margin: margin };
}

function normalizeRoomCandidate_(roomStr) {
  if (!roomStr) return '';

  const cleaned = String(roomStr).trim();
  const withoutLabels = cleaned.replace(/\b(ROOM|RM|BLDG|NAC)\b/gi, '').trim();
  const suspicious = withoutLabels
    .replace(/O/g, '0')
    .replace(/I/g, '1')
    .replace(/l/g, '1')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/T/g, '7')
    .replace(/B/g, '8')
    .replace(/Q/g, '9')
    .replace(/\s+/g, '');

  const rangeMatch = suspicious.match(/^(\d{3,4})[-–—](\d{3,4})$/);
  if (rangeMatch) return rangeMatch[1] + '-' + rangeMatch[2];

  const pureDigits = suspicious.match(/\d{3,4}/);
  return pureDigits ? pureDigits[0] : '';
}

function normalizeInspectorForMatch_(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B')
    .replace(/7/g, 'T');
}
 
function levenshteinDistance_(a, b) {
  a = String(a || ''); b = String(b || '');
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
 
  const row = Array(bl + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= al; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = row[j];
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[bl];
}
 
function similarity_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a.length && !b.length) return 1;
  const dist = levenshteinDistance_(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : (1 - dist / maxLen);
}
 
/* =========================================================================
 * DATE HELPERS
 * ========================================================================= */
 
const MONTH_NAMES_ = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
 
/**
 * Rewrites any OCR'd date to MM-DD-YY, discarding whatever year the model
 * guessed and forcing CONFIG.TARGET_YEAR_SHORT instead (the OCR model
 * occasionally hallucinates the year; month/day are far more reliable).
 */
function enforceTargetYear(dateStr) {
  const fallback = '01-01-' + CONFIG.TARGET_YEAR_SHORT;
  if (!dateStr) return fallback;
 
  if (dateStr instanceof Date) {
    const month = String(dateStr.getMonth() + 1).padStart(2, '0');
    const day = String(dateStr.getDate()).padStart(2, '0');
    return month + '-' + day + '-' + CONFIG.TARGET_YEAR_SHORT;
  }
 
  const cleaned = String(dateStr).trim().replace(/[\/.\\ ]/g, '-');
  const mmdd = cleaned.match(/^(\d{1,2})-+(\d{1,2})/);
  if (!mmdd) return fallback;
 
  const month = String(mmdd[1]).padStart(2, '0');
  const day = String(mmdd[2]).padStart(2, '0');
  return month + '-' + day + '-' + CONFIG.TARGET_YEAR_SHORT;
}
 
/** True if an MM-DD-YY date falls after the current month â€” a sign the OCR misread the date. */
function isFutureMonth(dateStr) {
  if (!dateStr) return false;
 
  const parts = dateStr.split('-');
  if (parts.length !== 3) return false;
 
  const ocrMonth = parseInt(parts[0], 10) - 1; // JS months are 0-11
  const ocrYear = 2000 + parseInt(parts[2], 10);
 
  const today = new Date();
  if (ocrYear > today.getFullYear()) return true;
  if (ocrYear === today.getFullYear() && ocrMonth > today.getMonth()) return true;
  return false;
}
 
/** Turns a Date/Time cell into a "Mon YYYY" bucket key for the monthly summary tabs. */
function extractMonthKey(dateVal) {
  const fallback = defaultMonthKey_();
  if (!dateVal) return fallback;
 
  const match = String(dateVal).trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!match) return fallback;
 
  const monthNum = parseInt(match[1], 10);
  if (monthNum < 1 || monthNum > 12) return fallback;
 
  const year = match[3].length === 2 ? '20' + match[3] : match[3];
  return MONTH_NAMES_[monthNum - 1] + ' ' + year;
}
 
/** Current month/year â€” used whenever a date can't be parsed at all. */
function defaultMonthKey_() {
  // Default to July of the configured target year to match SAC behavior
  return 'Jul ' + CONFIG.TARGET_YEAR_FULL;
}
 
/* =========================================================================
 * ROOM HELPERS
 * ========================================================================= */
 
/** Strips prefixes like "Room"/"RM"/"NAC" and returns the bare number, or a "start-end" range. */
function extractPureRoomNumber(roomStr) {
  if (!roomStr) return '';
 
  const cleaned = String(roomStr).trim().replace(/\b(ROOM|RM|BLDG|NAC)\b/gi, '');
 
  const rangeMatch = cleaned.match(/(\d{3,4})\s*[-â€“â€”]\s*(\d{3,4})/);
  if (rangeMatch) return rangeMatch[1] + '-' + rangeMatch[2];
 
  const digitMatch = cleaned.match(/\b\d{3,4}\b/);
  return digitMatch ? digitMatch[0] : extractDigits_(cleaned);
}
 
/** Expands a room or room-range ("301-305") into an array of individual room strings. */
function expandRoomRangeNAC(roomStr) {
  if (!roomStr) return [''];
 
  const cleaned = extractPureRoomNumber(roomStr);
  const rangeMatch = cleaned.match(/^(\d+)\s*[-â€“â€”]\s*(\d+)$/);
  if (!rangeMatch) return [roomStr.trim()];
 
  const start = parseInt(rangeMatch[1], 10);
  const end = parseInt(rangeMatch[2], 10);
  const pad = rangeMatch[1].length;
 
  if (start > end || (end - start) > CONFIG.MAX_ROOM_RANGE_SPAN) return [roomStr.trim()];
 
  const rooms = [];
  for (let roomNum = start; roomNum <= end; roomNum++) {
    rooms.push(String(roomNum).padStart(pad, '0'));
  }
  return rooms;
}
 
/** Returns the first run of digits in a string, or '' if there are none. */
function extractDigits_(value) {
  const match = String(value).match(/\d+/);
  return match ? match[0] : '';
}
 
/* =========================================================================
 * ROW BUILDING & DEDUPLICATION
 * ========================================================================= */
 
/** Flags anything a human should double-check before trusting the row. */
function checkNeedsReview(parsed, officialRoom, officialInspector, rawRoomString) {
  const reasons = [];

  parsed.answers.forEach((answer, index) => {
    if (answer === 'Unclear') reasons.push('Q' + (index + 1) + ' unclear');
  });

  if (parsed.dateMissing) reasons.push('date missing');
  if (!parsed.time) reasons.push('time missing');
  if (officialRoom === 'UNKNOWN') reasons.push('room unrecognized: ' + rawRoomString);

  const inspectorText = String(parsed.inspector || '').trim();
  if (!inspectorText) {
    reasons.push('inspector missing');
  } else {
    const inspectorDetails = getInspectorMatchDetails(parsed.inspector);
    const pct = Math.round(inspectorDetails.score * 100);
    const isAutoFilled = String(parsed.inspector).toUpperCase().indexOf('AUTO-FILLED') !== -1;
    const ambiguous = inspectorDetails.secondBest && ((inspectorDetails.score - inspectorDetails.margin) < CONFIG.INSPECTOR_MATCH_MARGIN_THRESHOLD);
    if (!inspectorDetails.match || inspectorDetails.score < CONFIG.INSPECTOR_MATCH_THRESHOLD || ambiguous) {
      if (!isAutoFilled) {
        reasons.push('inspector low-match (' + pct + '%): ' + parsed.inspector);
      }
    }
  }

  return reasons.length ? reasons.join('; ') : null;
}
 
/** Builds one full sheet row, in COLUMNS order, from a parsed form + room/inspector lookups. */
function buildRowData(parsed, fileName, reviewReason, officialRoom, officialInspector) {
  const totalYes = parsed.answers.filter((a) => a === 'Yes').length;
  const totalNo = parsed.answers.filter((a) => a === 'No').length;
  const normalizedDate = enforceTargetYear(parsed.date || '01-01-' + CONFIG.TARGET_YEAR_SHORT);
  const finalDateTime = normalizedDate + (parsed.time ? ' ' + parsed.time : '');
 
  const row = [];
  row[COLUMNS.TIMESTAMP] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM-dd-yy HH:mm:ss');
  row[COLUMNS.SCORE] = (totalYes * 10) + ' / ' + CONFIG.MAX_SCORE_PER_AUDIT;
  row[COLUMNS.DATE_TIME] = finalDateTime;
  row[COLUMNS.CAMPUS] = CONFIG.BUILDING_NAME;
  row[COLUMNS.ROOM] = officialRoom === 'UNKNOWN' ? '' : officialRoom;
  row[COLUMNS.Q1] = parsed.answers[0];
  row[COLUMNS.Q2] = parsed.answers[1];
  row[COLUMNS.Q3] = parsed.answers[2];
  row[COLUMNS.Q4] = parsed.answers[3];
  row[COLUMNS.Q5] = parsed.answers[4];
  row[COLUMNS.Q6] = parsed.answers[5];
  row[COLUMNS.Q7_TEACHER] = parsed.answers[6];
  row[COLUMNS.TEACHER_NAME] = parsed.teacher_name || '';
  row[COLUMNS.Q8] = parsed.answers[7];
  row[COLUMNS.COMMENTS] = parsed.comment || '';
  row[COLUMNS.INSPECTOR] = officialInspector === 'UNKNOWN' ? '' : officialInspector;
  row[COLUMNS.TOTAL_YES] = totalYes;
  row[COLUMNS.TOTAL_NO] = totalNo;
  row[COLUMNS.FILE_NAME] = fileName || '';
  row[COLUMNS.STATUS] = reviewReason ? ('NEEDS REVIEW: ' + reviewReason) : 'PASSED';
 
  return row;
}
 
/**
 * A record "fingerprint" used to detect duplicates: Date/Time, Room, all 8
 * answers, and the Comment. Teacher Name and Inspector are deliberately
 * excluded, since the same audit can be re-filed with a corrected name.
 */
function buildRecordSignature_(row) {
  return [
    row[COLUMNS.DATE_TIME],
    row[COLUMNS.ROOM],
    row[COLUMNS.Q1],
    row[COLUMNS.Q2],
    row[COLUMNS.Q3],
    row[COLUMNS.Q4],
    row[COLUMNS.Q5],
    row[COLUMNS.Q6],
    row[COLUMNS.Q7_TEACHER],
    row[COLUMNS.Q8],
    row[COLUMNS.COMMENTS]
  ]
    .map((value) => String(value).trim())
    .join('|')
    .toLowerCase();
}
 
/* =========================================================================
 * SCHEDULE LOOKUP
 * ========================================================================= */
 
const DAY_NAMES_ = Object.freeze(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']);
 
/** Looks up who was scheduled to check on a given date, for auto-filling a blank inspector. */
function lookupNACScheduledChecker(dateStr) {
  if (!dateStr) return null;

  const cleanDate = enforceTargetYear(dateStr);
  const parts = cleanDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  let parsedDate;

  if (parts) {
    parsedDate = new Date(2000 + parseInt(parts[3], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  } else {
    parsedDate = new Date(cleanDate);
  }

  if (isNaN(parsedDate.getTime())) return null;
 
  const daySchedule = NAC_CHECKER_SCHEDULE.find((s) => s.day === DAY_NAMES_[parsedDate.getDay()]);
  if (!daySchedule || !daySchedule.slots.length) return null;
 
  const firstSlot = daySchedule.slots[0];
  const checkers = [firstSlot.assigned, firstSlot.partner].filter(Boolean);
  return checkers.length ? checkers.join(' / ') : null;
}
 
/* =========================================================================
 * SHEET & FOLDER UTILITIES
 * ========================================================================= */
 
/** Picks the sheet the whole script operates on: "Logs", else "NAC", else whatever's active. */
function getMainSheet(ss) {
  const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet =
    spreadsheet.getSheetByName('Logs') ||
    spreadsheet.getSheetByName('NAC') ||
    spreadsheet.getActiveSheet() ||
    spreadsheet.getSheets()[0];
 
  return sheet || spreadsheet.insertSheet('NAC');
}
 
function ensureMinColumns(sheet, minCols) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < minCols) sheet.insertColumnsAfter(maxCols, minCols - maxCols);
}
 
function ensureSheetHeadersNAC(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    styleHeaderRowGreen(sheet);
  }
}
 
function styleHeaderRowGreen(sheet) {
  if (!sheet) return;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(1, 1, 1, lastCol).setBackground('#2E7D32').setFontColor('#FFFFFF').setFontWeight('bold');
}
 
function getOrCreateFolder(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}
 
function addLogEntry(ss, processed, review, duplicate, errors, runtimeSeconds) {
  const logSheet = ss.getSheetByName(CONFIG.RUN_LOG_SHEET_NAME) || ss.insertSheet(CONFIG.RUN_LOG_SHEET_NAME);
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['Timestamp', 'Processed', 'Needs Review', 'Duplicates', 'Errors', 'Runtime (s)']);
  }
  logSheet.appendRow([new Date(), processed, review, duplicate, errors, runtimeSeconds]);
}
 
/* =========================================================================
 * SORTING
 * ========================================================================= */
 
function removeAllRowGroups(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return;
 
  const maxRows = sheet.getMaxRows();
  const MAX_GROUP_DEPTH = 5;
 
  for (let depth = 0; depth < MAX_GROUP_DEPTH; depth++) {
    try {
      sheet.getRange(1, 1, maxRows, 1).ungroupRow();
    } catch (err) {
      break; // no more group levels left to remove
    }
  }
}
 
function sortSheetByRoomNumber(sheet) {
  if (!sheet) return;
 
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return;
 
  removeAllRowGroups(sheet);
 
  const roomRange = sheet.getRange(2, COLUMNS.ROOM + 1, lastRow - 1, 1);
  const roomValues = roomRange.getValues();
  for (let i = 0; i < roomValues.length; i++) {
    roomValues[i][0] = roomValues[i][0] ? extractPureRoomNumber(roomValues[i][0]) : '';
  }
  roomRange.setNumberFormat('@').setValues(roomValues);
  SpreadsheetApp.flush();
 
  sheet.getRange(2, 1, lastRow - 1, lastCol).sort([
    { column: COLUMNS.ROOM + 1, ascending: true },
    { column: COLUMNS.DATE_TIME + 1, ascending: true }
  ]);
}
 
/* =========================================================================
 * MONTHLY SUMMARY & CHARTS
 * ========================================================================= */
 
function generateNACSummaryNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  generateNACSummary(ss, getMainSheet(ss));
  ss.toast('NAC summary generated.', 'NAC Tools', 3);
}
 
function generateNACSummary(ss, dataSheet) {
  const sheet = dataSheet || getMainSheet(ss);
  if (!sheet || sheet.getLastRow() <= 1) {
    ss.toast('No data rows found in sheet.', 'Summary', 5);
    return;
  }
 
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const monthlyData = {};
 
  rows.forEach((row) => {
    const monthKey = extractMonthKey(row[COLUMNS.DATE_TIME]);
    if (!monthlyData[monthKey]) monthlyData[monthKey] = [];
    monthlyData[monthKey].push(row);
  });
 
  let months = Object.keys(monthlyData);
  if (!months.length) {
    const year = CONFIG.TARGET_YEAR_FULL;
    months = ['Jul','Aug','Sep','Oct','Nov','Dec'].map(m => m + ' ' + year);
    months.forEach(m => { monthlyData[m] = []; });
  }
 
  removeExistingNACSummarySheets_(ss);
  months.forEach((monthKey) => {
    const tabName = 'NAC Summary - ' + monthKey;
    const summarySheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
    summarySheet.clear();
    summarySheet.getCharts().forEach((chart) => summarySheet.removeChart(chart));
 
    summarySheet.getRange(1, 1)
      .setValue('ðŸ¢ NAC BUILDING MONITORING (' + monthKey.toUpperCase() + ')')
      .setFontWeight('bold')
      .setFontSize(13)
      .setFontColor('#1B5E20');
 
    const dataMap = aggregateNACData(monthlyData[monthKey]);
    const nextRow = renderNACTableAndChart(summarySheet, dataMap, 2, 'NAC (' + monthKey + '): Total YES vs NO by Room');
    const questionData = aggregateNACQuestionData(monthlyData[monthKey]);
    renderNACQuestionCharts(summarySheet, questionData, nextRow + 2);
    summarySheet.autoResizeColumns(1, 5);
  });
 
  ss.toast('âœ… Summary tabs created for ' + months.join(', '), 'NAC Summary', 5);
}
 
function aggregateNACData(dataRows) {
  const map = {};
  dataRows.forEach((row) => {
    const rawRoom = String(row[COLUMNS.ROOM] || '').trim();
    const room = getOfficialRoom(rawRoom);
    if (!room || room === 'UNKNOWN') return;

    if (!map[room]) map[room] = { room: room, audits: 0, yes: 0, no: 0 };
    map[room].audits += 1;
    map[room].yes += Number(row[COLUMNS.TOTAL_YES]) || 0;
    map[room].no += Number(row[COLUMNS.TOTAL_NO]) || 0;
  });
  return map;
}
 
function aggregateNACQuestionData(dataRows) {
  const map = {};
  const questionKeys = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7_TEACHER', 'Q8'];

  dataRows.forEach((row) => {
    const rawRoom = String(row[COLUMNS.ROOM] || '').trim();
    const room = getOfficialRoom(rawRoom);
    if (!room || room === 'UNKNOWN') return;

    if (!map[room]) {
      map[room] = { room: room, questionCounts: {} };
      questionKeys.forEach((q) => {
        map[room].questionCounts[q] = { Yes: 0, No: 0, Unclear: 0 };
      });
    }

    questionKeys.forEach((q) => {
      const value = String(row[COLUMNS[q]] || '').trim();
      if (value === 'Yes' || value === 'No' || value === 'Unclear') {
        map[room].questionCounts[q][value] += 1;
      }
    });
  });

  return map;
}

function renderNACQuestionCharts(sheet, questionData, startRow) {
  const chartStartCol = 7;
  const questionOrder = [
    { key: 'Q1', label: 'Q1' },
    { key: 'Q2', label: 'Q2' },
    { key: 'Q3', label: 'Q3' },
    { key: 'Q4', label: 'Q4' },
    { key: 'Q5', label: 'Q5' },
    { key: 'Q6', label: 'Q6' },
    { key: 'Q7_TEACHER', label: 'Q7 (Teacher)' },
    { key: 'Q8', label: 'Q8' }
  ];

  let currentRow = startRow;
  const roomKeys = Object.keys(questionData).sort();
  if (!roomKeys.length) {
    sheet.getRange(currentRow, 1, 1, 1).setValue('No question data available for this month.');
    return currentRow + 2;
  }

  questionOrder.forEach((questionInfo) => {
    const header = questionInfo.label + ' responses by room';
    sheet.getRange(currentRow, 1).setValue(header).setFontWeight('bold').setFontSize(11);
    currentRow += 1;

    const headers = ['Room', 'Yes', 'No', 'Unclear'];
    sheet.getRange(currentRow, 1, 1, headers.length)
      .setValues([headers])
      .setBackground('#2E7D32')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    currentRow += 1;

    const tableRows = roomKeys.map((room) => {
      const counts = questionData[room].questionCounts[questionInfo.key] || { Yes: 0, No: 0, Unclear: 0 };
      return [room, counts.Yes, counts.No, counts.Unclear];
    });

    sheet.getRange(currentRow, 1, tableRows.length, headers.length).setValues(tableRows);
    sheet.getRange(currentRow, 1, tableRows.length, 1).setNumberFormat('@');
    sheet.getRange(currentRow, 2, tableRows.length, 3).setNumberFormat('0');

    const chartRow = currentRow;
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sheet.getRange(chartRow - 1, 1, tableRows.length + 1, 4))
      .setPosition(chartRow, chartStartCol, 0, 0)
      .setOption('title', header)
      .setOption('hAxis', { title: 'Room', textStyle: { fontSize: 10 } })
      .setOption('vAxis', { title: 'Count', format: '0' })
      .setOption('legend', { position: 'top' })
      .setOption('colors', ['#2E7D32', '#C62828', '#F9A825'])
      .setOption('series', {
        0: { labelInLegend: 'Yes', color: '#2E7D32' },
        1: { labelInLegend: 'No', color: '#C62828' },
        2: { labelInLegend: 'Unclear', color: '#F9A825' }
      })
      .setOption('width', 600)
      .setOption('height', 300)
      .build();

    sheet.insertChart(chart);
    currentRow += tableRows.length + 3;
  });

  return currentRow;
}

function renderNACTableAndChart(sheet, dataMap, startRow, chartTitle) {
  // 1-based columns for this summary table only (separate from the main sheet's COLUMNS).
  const SUMMARY_COL = Object.freeze({ ROOM: 1, AUDITS: 2, YES: 3, NO: 4, COMPLIANCE: 5 });
  const headers = ['Room Number', 'Total Audits', 'Total YES', 'Total NO', 'Compliance Score (%)'];
 
  const tableData = Object.keys(dataMap).sort().map((room) => {
    const item = dataMap[room];
    const maxScore = item.audits * CONFIG.MAX_SCORE_PER_AUDIT;
    const pct = maxScore > 0 ? Math.round((item.yes * 10 / maxScore) * 100) + '%' : '0%';
    return [room, item.audits, item.yes, item.no, pct];
  });
 
  if (!tableData.length) {
    sheet.getRange(startRow, SUMMARY_COL.ROOM, 1, headers.length)
      .setValues([['No scans for this month', '-', '-', '-', '-']]);
    return startRow + 2;
  }
 
  sheet.getRange(startRow, SUMMARY_COL.ROOM, 1, headers.length)
    .setValues([headers])
    .setBackground('#2E7D32')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
 
  sheet.getRange(startRow + 1, SUMMARY_COL.ROOM, tableData.length, headers.length).setValues(tableData);
  sheet.getRange(startRow + 1, SUMMARY_COL.ROOM, tableData.length, 1).setNumberFormat('@');
  sheet.getRange(startRow + 1, SUMMARY_COL.AUDITS, tableData.length, 3).setNumberFormat('0');
  sheet.getRange(startRow + 1, SUMMARY_COL.COMPLIANCE, tableData.length, 1).setNumberFormat('@');
 
  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(startRow, SUMMARY_COL.ROOM, tableData.length + 1, 1))
    .addRange(sheet.getRange(startRow, SUMMARY_COL.YES, tableData.length + 1, 2))
    .setPosition(startRow, 7, 0, 0)
    .setOption('title', chartTitle)
    .setOption('hAxis', { title: 'Room', textStyle: { fontSize: 10 } })
    .setOption('vAxis', { title: 'Answer Tally', format: '0' })
    .setOption('legend', { position: 'top' })
    .setOption('colors', ['#2E7D32', '#C62828'])
    .setOption('series', {
      0: { labelInLegend: 'Total YES', color: '#2E7D32' },
      1: { labelInLegend: 'Total NO', color: '#C62828' }
    })
    .setOption('width', 750)
    .setOption('height', 380)
    .setOption('useFirstColumnAsDomain', true)
    .build();
 
  sheet.insertChart(chart);
  return startRow + tableData.length + 1;
}

function removeExistingNACSummarySheets_(ss) {
  try {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const name = sheets[i].getName();
      if (name.indexOf('NAC Summary - ') === 0) {
        try { ss.deleteSheet(sheets[i]); } catch (e) { /* ignore deletion failures */ }
      }
    }
  } catch (e) {
    console.error('Failed to remove existing NAC summary sheets:', e);
  }
}
