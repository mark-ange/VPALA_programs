/**
 * SAC Classroom Monitoring OCR System (Enhanced for Handwriting)
 * Improves OCR accuracy for handwritten forms without changing the core workflow.
 */

var SAC_CONFIG = Object.freeze({
  BUILDING_NAME: 'SAC',
  ENGINEERING_LABEL: 'SAC ENG',
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
  FOLDER_NAMES: Object.freeze({
    ROOT: 'SAC Reports',
    PENDING: 'Pending Scans',
    PROCESSED: 'Processed Scans',
    REVIEW: 'Needs Review',
    DUPLICATE: 'Duplicate Scans',
    FAILED: 'Failed Scans'
  }),
  RUN_LOG_SHEET_NAME: '?? SAC Run Log',
  SAC_ROOMS: Object.freeze([
    '101','102','103','104','105',
    '201','202','203','204','205','206','207','208','209',
    '301','302','303','304','305','306','307','308',
    '401','402','403','404','405','406','407','408',
    '507','508'
  ]),
  SAC_EENG_ROOMS: Object.freeze([
    '101','103','105',
    '201','202','203','204','205'
  ]),
  OFFICIAL_CHECKERS: Object.freeze([
    'ABELLANO', 'BALICAO', 'BASLOT', 'PACUIN', 'BERMOY', 'TALLE',
    'ABSIN', 'BACUS', 'LIM', 'BABAO', 'ARIZA', 'AMPLAYO',
    'EBABACOL', 'RAZALO', 'ELLO', 'LOMONSOD', 'PIMPING',
    'CENA', 'NOYNAY', 'GUANGCO', 'BUNGALON', 'GAAN'
  ])
});

// Handwriting misreads for common OCR errors
const HANDWRITING_MISREADS = Object.freeze({
  room: {
    '404': ['401', '407', '414', '440', '400'],
    '401': ['404', '411', '407', '400'],
    '205': ['206', '250', '208', '200'],
    '206': ['205', '260', '208', '200'],
    '101': ['107', '111', '104', '100'],
    '102': ['107', '120', '108', '100'],
    '103': ['108', '130', '109', '100'],
    '104': ['101', '140', '100'],
    '105': ['106', '150', '109', '100'],
    '301': ['310', '307', '300'],
    '302': ['320', '308', '300'],
    '303': ['330', '309', '300'],
  },
  inspector: {
    'BERMOY': ['BERNOY', 'BERMON', 'BUNNOY', 'BUNMOY', 'BERMOY'],
    'BUNNY': ['BUNNEY', 'BUNI', 'BUNEY', 'BUNY'],
    'PACUIN': ['PACUN', 'PACIN', 'PACUIN', 'PACUINN'],
    'LOMONSOD': ['LOMONSAD', 'LOMOND', 'LOMONSOD', 'LOMONSOD'],
    'BACUS': ['BACAS', 'BACUZ', 'BACUS', 'BACUSS'],
    'GAAN': ['GAON', 'GAIN', 'GAAN', 'GAANN'],
    'TALLE': ['TALLY', 'TALI', 'TALLE', 'TALLEE'],
    'BALICAO': ['BALICO', 'BALICA', 'BALICAO', 'BALICAOO'],
    'BASLOT': ['BASLAT', 'BASLOT', 'BASLOTT'],
    'ABELLANO': ['ABELANO', 'ABELYANO', 'ABELLANO', 'ABELLANOO'],
    'EBABACOL': ['EBABACOL', 'EBABACOLL', 'EBABACO'],
    'RAZALO': ['RAZALO', 'RAZALOO', 'RAZAL'],
    'ELLO': ['ELLO', 'ELLOO', 'ELL'],
    'PIMPING': ['PIMPING', 'PIMPIN', 'PIMPINGG'],
    'CENA': ['CENA', 'CENAA', 'CEEN'],
    'NOYNAY': ['NOYNAY', 'NOYNAYY', 'NOYNA'],
    'GUANGCO': ['GUANGCO', 'GUANGCOO', 'GUANGC'],
    'BUNGALON': ['BUNGALON', 'BUNGALONN', 'BUNGALO'],
    'ARIZA': ['ARIZA', 'ARIZAA', 'ARIZ'],
    'AMPLAYO': ['AMPLAYO', 'AMPLAYOO', 'AMPLAY'],
    'LIM': ['LIM', 'LIMM', 'LI'],
    'BABAO': ['BABAO', 'BABAOO', 'BABA'],
  },
  answers: {
    'Yes': ['Yas', 'Yez', 'Yis', 'Yep', 'Ys', 'Ye', 'Yess', 'Yesss'],
    'No': ['N0', 'N00', 'Nn', 'Nn0', 'Nno', 'Nnoo'],
  },
});

SAC_CONFIG.INSPECTOR_MATCH_THRESHOLD = 0.7; // Lowered from 0.8 for handwriting
SAC_CONFIG.ROOM_MATCH_THRESHOLD = 0.8;

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

const SAC_CHECKER_SCHEDULE = Object.freeze([
  { day: 'MONDAY', shifts: [
    { shift: 'First Shift', slots: [
      { time: '7:30-8:00', assignments: { sac_eeng: { assigned: 'PACUIN' }, sac: { assigned: 'BERMOY' } } },
      { time: '8:30-9:30', assignments: { sac_eeng: { assigned: 'PACUIN' }, sac: { assigned: 'BERMOY' } } },
      { time: '9:30-10:30', assignments: { sac_eeng: { assigned: 'PACUIN' }, sac: { assigned: 'BERMOY' } } },
      { time: '10:30-11:30', assignments: { sac_eeng: { assigned: 'PACUIN' }, sac: { assigned: 'BERMOY' } } },
      { time: '11:30-12:00', assignments: { sac_eeng: { assigned: 'PACUIN' }, sac: { assigned: 'BERMOY' } } }
    ] },
    { shift: '2nd Shift', slots: [
      { time: '1:00-2:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } },
      { time: '2:30-3:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } },
      { time: '3:30-4:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } },
      { time: '4:30-5:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } }
    ] }
  ] },
  { day: 'TUESDAY', shifts: [
    { shift: 'First Shift', slots: [
      { time: '7:30-8:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '8:30-9:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '9:30-10:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '10:30-11:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '11:30-12:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } }
    ] },
    { shift: '2nd Shift', slots: [
      { time: '1:00-2:30', assignments: { sac_eeng: { assigned: 'LOMONSOD', partner: 'ARIZA' }, sac: { assigned: 'EBABACOL', partner: 'BACUS' } } },
      { time: '2:30-3:30', assignments: { sac_eeng: { assigned: 'LOMONSOD', partner: 'ARIZA' }, sac: { assigned: 'EBABACOL', partner: 'BACUS' } } },
      { time: '3:30-4:30', assignments: { sac_eeng: { assigned: 'LOMONSOD', partner: 'ARIZA' }, sac: { partner: 'BACUS' } } },
      { time: '4:30-5:00', assignments: { sac_eeng: { assigned: 'LOMONSOD', partner: 'ARIZA' }, sac: { partner: 'BACUS' } } }
    ] }
  ] },
  { day: 'WEDNESDAY', shifts: [
    { shift: 'First Shift', slots: [
      { time: '7:30-8:00', assignments: { sac_eeng: { assigned: 'ARIZA' }, sac: { assigned: 'BERMOY' } } },
      { time: '8:30-9:30', assignments: { sac_eeng: { assigned: 'ARIZA' }, sac: { assigned: 'BERMOY' } } },
      { time: '9:30-10:30', assignments: { sac_eeng: { assigned: 'ARIZA' }, sac: { assigned: 'BERMOY' } } },
      { time: '10:30-11:30', assignments: { sac_eeng: { assigned: 'ARIZA' }, sac: { assigned: 'BERMOY' } } },
      { time: '11:30-12:00', assignments: { sac_eeng: { assigned: 'ARIZA' }, sac: { assigned: 'BERMOY' } } }
    ] },
    { shift: '2nd Shift', slots: [
      { time: '1:00-2:30', assignments: { sac_eeng: { assigned: 'BACUS' }, sac: { assigned: 'GAAN' } } },
      { time: '2:30-3:30', assignments: { sac_eeng: { assigned: 'BACUS' }, sac: { assigned: 'GAAN' } } },
      { time: '3:30-4:30', assignments: { sac_eeng: { assigned: 'BACUS' }, sac: { assigned: 'GAAN' } } },
      { time: '4:30-5:00', assignments: { sac_eeng: { assigned: 'BACUS' }, sac: { assigned: 'GAAN' } } }
    ] }
  ] },
  { day: 'THURSDAY', shifts: [
    { shift: 'First Shift', slots: [
      { time: '7:30-8:00', assignments: { sac_eeng: { partner: 'BABAO' }, sac: { assigned: 'BERMOY' } } },
      { time: '8:30-9:30', assignments: { sac_eeng: { partner: 'BABAO' }, sac: { assigned: 'BERMOY' } } },
      { time: '9:30-10:30', assignments: { sac_eeng: { partner: 'BABAO' }, sac: { assigned: 'BERMOY' } } },
      { time: '10:30-11:30', assignments: { sac_eeng: { partner: 'BABAO' }, sac: { assigned: 'BERMOY' } } },
      { time: '11:30-12:00', assignments: { sac: { assigned: 'BERMOY' } } }
    ] },
    { shift: '2nd Shift', slots: [
      { time: '1:00-2:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } },
      { time: '2:30-3:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } },
      { time: '3:30-4:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } },
      { time: '4:30-5:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'BACUS' } } }
    ] }
  ] },
  { day: 'FRIDAY', shifts: [
    { shift: 'First Shift', slots: [
      { time: '7:30-8:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '8:30-9:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '9:30-10:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '10:30-11:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '11:30-12:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } }
    ] },
    { shift: '2nd Shift', slots: [
      { time: '1:00-2:30', assignments: { sac_eeng: { assigned: 'BACUS' }, sac: { assigned: 'EBABACOL' } } },
      { time: '2:30-3:30', assignments: { sac_eeng: { assigned: 'BACUS' }, sac: { assigned: 'EBABACOL' } } },
      { time: '3:30-4:30', assignments: { sac_eeng: { assigned: 'BACUS' } } },
      { time: '4:30-5:00', assignments: { sac_eeng: { assigned: 'BACUS' } } }
    ] }
  ] },
  { day: 'SATURDAY', shifts: [
    { shift: 'First Shift', slots: [
      { time: '7:30-8:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'AMPLAYO' } } },
      { time: '8:30-9:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'AMPLAYO' } } },
      { time: '9:30-10:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '10:30-11:30', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } },
      { time: '11:30-12:00', assignments: { sac_eeng: { assigned: 'LOMONSOD' }, sac: { assigned: 'EBABACOL' } } }
    ] },
    { shift: '2nd Shift', slots: [
      { time: '1:00-2:30', assignments: { sac_eeng: { assigned: 'PACUIN' } } },
      { time: '2:30-3:30', assignments: { sac_eeng: { assigned: 'PACUIN' } } },
      { time: '3:30-4:30', assignments: { sac_eeng: { assigned: 'PACUIN' } } },
      { time: '4:30-5:00', assignments: { sac_eeng: { assigned: 'PACUIN' } } }
    ] }
  ] }
]);

// ========== MENU & SETUP FUNCTIONS ==========
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('?? SAC Tools')
    .addItem('Scan Pending SAC Reports', 'scanPaperReportsSAC')
    .addItem('? Install Hourly Auto-Trigger', 'setupTimeDrivenTrigger')
    .addItem('?? Setup / Reset Sheet Headers', 'setupSheetHeaders')
    .addItem('?? Sort & Group Sheets Now', 'sortSACSheetNow')
    .addItem('?? Clean Existing Room Numbers', 'cleanExistingRoomsInSheet')
    .addItem('?? Generate Monthly Summaries & Charts', 'generateRoomSummarySACNow')
    .addItem('?? Refresh Summaries Only', 'refreshSummariesOnly')
    .addItem('?? Format Header Row Green', 'formatHeaderGreenNow')
    .addToUi();
}

function getTargetSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openByUrl(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_URL'));
}

function ensureMinColumns(sheet, minCols) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < minCols) sheet.insertColumnsAfter(maxCols, minCols - maxCols);
}

function styleHeaderRowGreen(sheet) {
  if (!sheet) return;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(1, 1, 1, lastCol)
    .setBackground('#2E7D32')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
}

function setupTimeDrivenTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'scanPaperReportsSAC') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('scanPaperReportsSAC').timeBased().everyHours(1).create();

  const ss = getTargetSpreadsheet();
  if (ss) PropertiesService.getScriptProperties().setProperty('SPREADSHEET_URL', ss.getUrl());
}

function setupSheetHeaders() {
  const ss = getTargetSpreadsheet();
  ['SAC', 'SAC ENG'].forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    ensureMinColumns(sheet, HEADERS.length);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    styleHeaderRowGreen(sheet);
  });
}

function formatHeaderGreenNow() {
  const ss = getTargetSpreadsheet();
  const sheet = ss ? ss.getActiveSheet() : null;
  styleHeaderRowGreen(sheet);
}

// ========== CORE OCR & PROCESSING FUNCTIONS ==========
function scanPaperReportsSAC() {
  const startTime = Date.now();
  const folders = getSACFolders_();
  const apiKey = PropertiesService.getScriptProperties().getProperty('MISTRAL_API_KEY');
  if (!apiKey) {
    const ss = getTargetSpreadsheet();
    if (ss) ss.toast('Missing MISTRAL_API_KEY', 'SAC Error', 10);
    return;
  }

  const ss = getTargetSpreadsheet();
  const sheet = ensureSACSheet(ss, 'SAC');
  const engSheet = ensureSACSheet(ss, 'SAC ENG');

  const existingSignatures = loadExistingSignatures_(ss);
  const pendingFiles = getPendingFilesSorted_(folders.pending);
  const tally = { processed: 0, review: 0, duplicate: 0, error: 0 };

  for (let i = 0; i < pendingFiles.length; i++) {
    const filesHandled = tally.processed + tally.review + tally.duplicate + tally.error;
    if (filesHandled >= SAC_CONFIG.MAX_FILES_PER_BATCH) break;
    if (Date.now() - startTime >= SAC_CONFIG.RUN_TIME_BUDGET_MS) break;

    const file = pendingFiles[i];
    const mimeType = file.getMimeType();
    if (!mimeType.startsWith('image/')) {
      safeMoveTo_(file, folders.error);
      tally.error++;
      continue;
    }

    const outcome = processSingleSACFile_(file, { ss, apiKey, folders, existingSignatures });
    tally[outcome]++;
    Utilities.sleep(SAC_CONFIG.THROTTLE_MS);
  }

  finalizeSACRun_(ss, tally, startTime);
}

function processSingleSACFile_(file, ctx) {
  const { ss, apiKey, folders, existingSignatures } = ctx;
  const fileName = file.getName();

  try {
    const parsed = readSACFormFromImage_(file, apiKey);
    console.log('Parsed data for ' + fileName + ':', JSON.stringify(parsed));

    const reviewReasons = checkNeedsReview(parsed, parsed.room);
    if (reviewReasons) {
      console.log('Review reasons for ' + fileName + ':', reviewReasons);
    }

    // Force review if too many issues
    if (reviewReasons && reviewReasons.split(';').length >= 3) {
      safeMoveTo_(file, folders.review);
      return 'review';
    }

    const targetSheet = chooseTargetSheet_(ss, parsed);
    const { appendedAny, needsReview } = appendParsedRoomsToSheet_(parsed, fileName, targetSheet, existingSignatures);

    if (!appendedAny) {
      safeMoveTo_(file, folders.duplicate);
      return 'duplicate';
    }

    safeMoveTo_(file, needsReview ? folders.review : folders.processed);
    return needsReview ? 'review' : 'processed';
  } catch (err) {
    console.error('SAC scan failed for "' + fileName + '":', err);
    logOCRError(ss, fileName, String(err));
    safeMoveTo_(file, folders.error);
    return 'error';
  }
}

function readSACFormFromImage_(file, apiKey) {
  const blob = file.getBlob().getAs('image/jpeg');
  let parsed = extractFormDataWithFallback(blob, blob.getContentType(), apiKey);

  parsed = normalizeParsedFieldTree_(parsed);
  parsed.answers = normalizeAnswers(parsed.answers);

  const criticalFields = ['room', 'inspector', 'date', 'teacherName'];
  const needsSecondPass = criticalFields.some((fieldName) => {
    const value = fieldName === 'teacherName' ? (parsed.teacher_name || parsed.teacherName || '') : (parsed[fieldName] || '');
    return fieldConfidence_(value, fieldName) < SAC_CONFIG.OCR_FIELD_CONFIDENCE_THRESHOLD;
  });

  if (needsSecondPass) {
    const secondPass = extractRecheckWithMistralSAC(blob, blob.getContentType(), apiKey, parsed);
    if (secondPass) {
      parsed = mergeCriticalFieldReads_(parsed, normalizeParsedFieldTree_(secondPass));
    }
  }

  parsed.room = getOfficialRoom(parsed.room || parsed.roomInfo && parsed.roomInfo.raw);
  const dateCandidate = parsed.dateInfo && parsed.dateInfo.normalized ? parsed.dateInfo.normalized : parsed.date;
  parsed.date = enforceTargetYear(dateCandidate);
  parsed.dateMissing = !dateCandidate || String(dateCandidate).trim() === '';

  if (isFutureMonth(parsed.date)) {
    throw new Error('OCR produced an impossible future month (' + parsed.date + ').');
  }

  const inspectorRaw = parsed.inspectorInfo ? parsed.inspectorInfo.raw : parsed.inspector;
  const hasRecognizableInspector = !!(inspectorRaw && inspectorRaw.trim() && getOfficialInspector(inspectorRaw) !== 'UNKNOWN');
  if (!hasRecognizableInspector) {
    const schedule = lookupSACScheduledChecker(parsed.date, parsed.time, parsed.room, parsed.campus);
    if (schedule.length) {
      parsed.inspector = schedule.join(' / ') + ' (Auto-filled)';
      parsed.inspectorInfo = { raw: parsed.inspector, normalized: schedule[0], confidence: 0.8 };
    }
  } else {
    parsed.inspector = inspectorRaw;
  }

  parsed.inspector = getOfficialInspector(parsed.inspector);
  return parsed;
}

// Fallback OCR if Mistral fails
function extractFormDataWithFallback(blob, mimeType, apiKey) {
  try {
    return extractFormDataWithMistralSAC(blob, mimeType, apiKey);
  } catch (e) {
    console.warn('Mistral OCR failed, falling back to Google Drive OCR:', e);
    return extractFormDataWithGoogleOCR(blob);
  }
}

function extractRecheckWithMistralSAC(blob, mimeType, apiKey, previousParsed) {
  const payload = buildMistralPayload_(blob, mimeType, true, previousParsed);
  const content = callMistralWithRetry_(payload, apiKey);
  const parsed = JSON.parse(content);
  if (!parsed || parsed.isSacForm === false || !Array.isArray(parsed.answers) || parsed.answers.length !== 8) return null;
  return normalizeParsedFieldTree_(parsed);
}

function extractFormDataWithMistralSAC(blob, mimeType, apiKey) {
  const payload = buildMistralPayload_(blob, mimeType, false);
  const content = callMistralWithRetry_(payload, apiKey);
  const parsed = JSON.parse(content);
  if (!parsed || parsed.isSacForm === false || !Array.isArray(parsed.answers) || parsed.answers.length !== 8) {
    throw new Error('Mistral returned an unexpected SAC form structure.');
  }
  return normalizeParsedFieldTree_(parsed);
}

function extractFormDataWithGoogleOCR(blob) {
  const file = DriveApp.createFile(blob);
  try {
    const doc = DocumentApp.openFileById(file.getId());
    const text = doc.getText();
    file.setTrashed(true);

    const parsed = {
      isSacForm: true,
      date: null,
      time: null,
      campus: null,
      room: null,
      answers: Array(8).fill('Unmarked'),
      teacherName: null,
      comment: null,
      inspector: null,
    };

    // Extract date
    const dateMatch = text.match(/Date:\s*([^\n]+)/i);
    if (dateMatch) parsed.date = dateMatch[1].trim();

    // Extract time
    const timeMatch = text.match(/Time:\s*([^\n]+)/i);
    if (timeMatch) parsed.time = timeMatch[1].trim();

    // Extract campus
    const campusMatch = text.match(/Campus:\s*([^\n]+)/i);
    if (campusMatch) parsed.campus = campusMatch[1].trim();

    // Extract room
    const roomMatch = text.match(/Room:\s*([^\n]+)/i);
    if (roomMatch) parsed.room = roomMatch[1].trim();

    // Extract answers
    const answerMatches = text.matchAll(/(\d+)\.\s*(Yes|No|Y|N|Unmarked|Unclear)/gi);
    for (const match of answerMatches) {
      const qNum = parseInt(match[1], 10) - 1;
      if (qNum >= 0 && qNum < 8) {
        parsed.answers[qNum] = match[2].trim();
      }
    }

    // Extract inspector
    const inspectorMatch = text.match(/Inspector:\s*([^\n]+)/i);
    if (inspectorMatch) parsed.inspector = inspectorMatch[1].trim();

    // Extract comment
    const commentMatch = text.match(/Comment:\s*([^\n]+)/i);
    if (commentMatch) parsed.comment = commentMatch[1].trim();

    return parsed;
  } catch (e) {
    file.setTrashed(true);
    throw new Error('Google Drive OCR failed: ' + e);
  }
}

function buildMistralPayload_(blob, mimeType, isRecheck, previousParsed) {
  const dataUrl = 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes());
  return {
    model: SAC_CONFIG.MISTRAL_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildOcrPrompt_(isRecheck, previousParsed) },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }],
    response_format: { type: 'json_object' },
    temperature: SAC_CONFIG.OCR_TEMPERATURE
  };
}

function buildOcrPrompt_(isRecheck, previousParsed) {
  const instructions = [
    'You are an expert OCR parser for SAC Classroom Monitoring Sheets.',
    'The form may contain HANDWRITTEN text. Be lenient with spelling and formatting errors.',
    'Inspect the whole page before deciding. Read the printed labels and then the handwritten entries in each field.',
    'Avoid assuming characters are unreadable. Compare visually similar characters, especially O/0, 1/I/l, 2/Z, 3/8, 5/S, 6/G, 7/T/1, 8/B, 9/g.',
    'Treat missing spaces, dashes, slashes, shadows, slight tilt, or handwriting loops as normal variation.',
    'Extract the following fields: date, time, campus, room, 8 answers, teacherName, comment, inspector.',
    'Return the best raw reading for each field and include a confidence estimate for the critical fields.',
    'Normalize dates to MM-DD-YYYY format. If the year is missing, assume 2026.',
    'For room numbers, extract ONLY the numeric part (e.g., "404" from "Room 404" or "RM404").',
    'For answers, ONLY return: "Yes", "No", "Unmarked", or "Unclear".',
    'For inspector names, match against: ' + SAC_CONFIG.OFFICIAL_CHECKERS.join(', ') + '.',
    'If the inspector name is unclear, return "UNKNOWN".',
    'If the room is unclear, return "UNKNOWN".',
    'Output strict JSON with this schema (including raw, normalized, confidence):',
    JSON.stringify({
      isSacForm: true,
      date: { raw: '07/16/26', normalized: '07-16-2026', confidence: 0.92 },
      time: { raw: '8:30-9:30 AM', normalized: '8:30-9:30 AM', confidence: 0.9 },
      campus: { raw: 'SAC', normalized: 'SAC', confidence: 0.9 },
      room: { raw: '404', normalized: '404', confidence: 0.9 },
      answers: ['Yes','No','Unmarked','Yes','Unmarked','Yes','No','Yes'],
      teacherName: { raw: 'M. Santos', normalized: 'M. Santos', confidence: 0.88 },
      comment: { raw: 'string', normalized: 'string', confidence: 0.8 },
      inspector: { raw: 'BASLOT', normalized: 'BASLOT', confidence: 0.92 }
    })
  ];

  if (isRecheck && previousParsed) {
    instructions.push('SECOND PASS ONLY: Re-examine room number, inspector, date, and teacher name. Do not repeat the first answer blindly. Check for skewed digits, letters that look alike, and partial loops before finalizing.');
    instructions.push('Previous raw reading: ' + JSON.stringify({
      date: previousParsed.dateInfo || previousParsed.date,
      room: previousParsed.roomInfo || previousParsed.room,
      inspector: previousParsed.inspectorInfo || previousParsed.inspector,
      teacherName: previousParsed.teacherInfo || previousParsed.teacherName || previousParsed.teacher_name
    }));
  }

  return instructions.join('\n');
}

function normalizeParsedFieldTree_(parsed) {
  const out = Object.assign({}, parsed || {});

  const normalizeField = (fieldValue, fallbackValue) => {
    if (fieldValue && typeof fieldValue === 'object') {
      const rawValue = fieldValue.raw != null ? fieldValue.raw : (fieldValue.value != null ? fieldValue.value : (fieldValue.normalized != null ? fieldValue.normalized : fallbackValue));
      const normalizedValue = fieldValue.normalized != null ? fieldValue.normalized : rawValue;
      const confidence = Number(fieldValue.confidence || 0);
      return {
        raw: String(rawValue ?? ''),
        normalized: String(normalizedValue ?? ''),
        confidence: isNaN(confidence) ? 0 : confidence
      };
    }

    const raw = String(fieldValue == null ? fallbackValue : fieldValue);
    return { raw, normalized: raw, confidence: 0 };
  };

  out.dateInfo = normalizeField(out.date, '');
  out.timeInfo = normalizeField(out.time, '');
  out.roomInfo = normalizeField(out.room, '');
  out.teacherInfo = normalizeField(out.teacherName != null ? out.teacherName : out.teacher_name, '');
  out.inspectorInfo = normalizeField(out.inspector, '');

  out.date = out.dateInfo.normalized || out.dateInfo.raw || '';
  out.time = out.timeInfo.normalized || out.timeInfo.raw || '';
  out.room = out.roomInfo.normalized || out.roomInfo.raw || '';
  out.teacherName = out.teacherInfo.normalized || out.teacherInfo.raw || '';
  out.teacher_name = out.teacherName;
  out.inspector = out.inspectorInfo.normalized || out.inspectorInfo.raw || '';

  return out;
}

function mergeCriticalFieldReads_(primary, secondary) {
  const out = Object.assign({}, primary || {});
  const keys = ['date', 'room', 'inspector', 'teacherName'];

  keys.forEach((key) => {
    const primaryInfo = out[key + 'Info'] || { raw: out[key] || '', normalized: out[key] || '', confidence: 0 };
    const secondaryInfo = secondary && secondary[key + 'Info'] ? secondary[key + 'Info'] : { raw: secondary && secondary[key] ? secondary[key] : '', normalized: secondary && secondary[key] ? secondary[key] : '', confidence: 0 };
    const shouldUseSecondary = !primaryInfo.raw || (secondaryInfo.confidence > primaryInfo.confidence) || (secondaryInfo.raw && !primaryInfo.normalized && !primaryInfo.raw);

    if (shouldUseSecondary && secondaryInfo.raw) {
      out[key + 'Info'] = secondaryInfo;
      out[key] = secondaryInfo.normalized || secondaryInfo.raw || out[key];
      if (key === 'teacherName') out.teacher_name = out[key];
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

  for (let attempt = 0; attempt < SAC_CONFIG.OCR_MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch(SAC_CONFIG.MISTRAL_ENDPOINT, options);
      const code = response.getResponseCode();
      const text = response.getContentText();
      if ([429, 500, 502, 503, 504].indexOf(code) !== -1) {
        Utilities.sleep(Math.min(Math.pow(2, attempt) * 1000, 16000));
        continue;
      }
      if (code !== 200) {
        throw new Error('Mistral error (' + code + '): ' + text);
      }
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.choices) || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        throw new Error('Mistral returned an unexpected response structure.');
      }
      return data.choices[0].message.content.trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/\s*`{3}$/, '').trim();
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      const transient = /429|timeout|temporar|rate limit|500|502|503|504/i.test(message);
      if (attempt < SAC_CONFIG.OCR_MAX_RETRIES - 1 && transient) {
        Utilities.sleep(Math.min(Math.pow(2, attempt) * 1000, 16000));
        continue;
      }
      throw new Error('Mistral request failed: ' + message);
    }
  }
  throw new Error('Mistral rate-limit retries exhausted.');
}

// ========== ENHANCED NORMALIZATION FUNCTIONS ==========
function normalizeAnswers(answers) {
  if (!Array.isArray(answers)) return Array(8).fill('Unmarked');
  return answers.map(ans => {
    const s = String(ans || '').trim().toLowerCase();

    // Check for common handwriting misreads
    for (const [official, misreads] of Object.entries(HANDWRITING_MISREADS.answers)) {
      if (misreads.includes(s)) {
        return official;
      }
    }

    if (['yes', 'y', 'true'].includes(s)) return 'Yes';
    if (['no', 'n', 'false'].includes(s)) return 'No';
    if (['unmarked', 'blank', 'none', 'n/a', ''].includes(s)) return 'Unmarked';
    return 'Unclear';
  });
}

function enforceTargetYear(dateStr) {
  if (!dateStr) return `07-16-${SAC_CONFIG.TARGET_YEAR_FULL}`;
  let cleaned = String(dateStr).trim().replace(/[\.\/\\, ]/g, '-');

  // Handle month names (e.g., "July 16 2026" or "16 July 2026")
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  for (let i = 0; i < monthNames.length; i++) {
    const monthNum = i + 1;
    const regex = new RegExp(monthNames[i], 'i');
    if (regex.test(cleaned)) {
      const dayMatch = cleaned.match(/\b(\d{1,2})\b/);
      const yearMatch = cleaned.match(/\b(\d{4})\b/);
      if (dayMatch && yearMatch) {
        return `${String(monthNum).padStart(2, '0')}-${dayMatch[1].padStart(2, '0')}-${yearMatch[1]}`;
      }
    }
  }

  // Handle MM-DD-YY or MM-DD-YYYY
  const parts = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (parts) {
    const year = parts[3].length === 2 ? SAC_CONFIG.TARGET_YEAR_FULL : Number(parts[3]);
    return `${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}-${year}`;
  }

  return `07-16-${SAC_CONFIG.TARGET_YEAR_FULL}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  // Handle ranges like "7:30-11:00AM" by taking the start time
  const rangePart = timeStr.split(/[-–—]/)[0].trim();
  const clean = rangePart.toUpperCase().replace(/\s+/g, '');

  // Handle 24-hour format (e.g., 13:00)
  const match24h = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24h) {
    const hours = parseInt(match24h[1], 10);
    const minutes = parseInt(match24h[2], 10);
    return hours * 60 + minutes;
  }

  // Handle 12-hour format (e.g., 7:30AM, 7:30 PM)
  const match12h = clean.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)?$/i);
  if (match12h) {
    let hours = parseInt(match12h[1], 10);
    const minutes = match12h[2] ? parseInt(match12h[2], 10) : 0;
    const ampm = (match12h[3] || '').toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  return null;
}

function extractPureRoomNumber(roomStr) {
  if (!roomStr) return '';
  let cleaned = String(roomStr).trim()
    .replace(/\b(ROOM|RM|BLDG|BUILDING|SCI|STC|HAVE\s*CLASS|SAC|ENG|FLOOR|LEVEL|NUMBER)\b/gi, '')
    .replace(/[\(\)\-\s]/g, ''); // Remove parentheses, hyphens, and spaces

  // Extract the first 3-4 digit number
  const digitMatch = cleaned.match(/\b(\d{3,4})\b/);
  if (digitMatch) return digitMatch[1];

  // Fallback: extract all digits
  const fallback = cleaned.match(/\d+/);
  return fallback ? fallback[0] : '';
}

function getRoomMatchResult(roomStr) {
  const input = normalizeRoomCandidate_(roomStr);
  if (!input) return { value: '', official: false };

  const allRooms = SAC_CONFIG.SAC_ROOMS.concat(SAC_CONFIG.SAC_EENG_ROOMS);
  if (SAC_CONFIG.SAC_ROOMS.includes(input) || SAC_CONFIG.SAC_EENG_ROOMS.includes(input)) {
    return { value: input, official: true };
  }

  for (const [official, misreads] of Object.entries(HANDWRITING_MISREADS.room)) {
    if (misreads.includes(input)) {
      return { value: official, official: true };
    }
  }

  const numeric = input.replace(/\D/g, '');
  const scored = allRooms.map((c) => ({ cand: c, score: numeric ? similarity_(numeric, String(c)) : similarity_(String(input), String(c)) })).sort((a, b) => b.score - a.score);
  const best = scored[0] || { cand: null, score: 0 };
  const second = scored[1] || { cand: null, score: 0 };

  if (!best.cand || best.score < SAC_CONFIG.ROOM_MATCH_THRESHOLD) return { value: input, official: false };
  if (second && (best.score - second.score) < SAC_CONFIG.ROOM_MATCH_MARGIN_THRESHOLD) return { value: input, official: false };
  return { value: best.cand, official: true };
}

function getOfficialRoom(roomStr) {
  const result = getRoomMatchResult(roomStr);
  return result.official ? result.value : 'UNKNOWN';
}

function getInspectorMatchDetails(inspectorStr) {
  const clean = String(inspectorStr || '').trim();
  if (!clean) return { match: null, score: 0, secondBest: null, margin: 0 };
  if (clean.toUpperCase().includes('AUTO-FILLED')) return { match: inspectorStr, score: 1, secondBest: null, margin: 1 };

  const up = clean.toUpperCase();
  const misreadMatch = Object.entries(HANDWRITING_MISREADS.inspector).find(([official, misreads]) => misreads.includes(up));
  if (misreadMatch) {
    return { match: misreadMatch[0], score: 1, secondBest: null, margin: 1 };
  }

  const scored = SAC_CONFIG.OFFICIAL_CHECKERS.map((checker) => ({
    cand: checker,
    score: similarity_(normalizeInspectorForMatch_(up), normalizeInspectorForMatch_(checker))
  })).sort((a, b) => b.score - a.score);

  const best = scored[0] || { cand: null, score: 0 };
  const second = scored[1] || { cand: null, score: 0 };
  const margin = best.score - second.score;
  return { match: best.cand, score: best.score, secondBest: second.cand, margin: margin };
}

function getOfficialInspector(inspectorStr) {
  if (!inspectorStr) return 'UNKNOWN';
  const clean = String(inspectorStr).trim();
  const upper = clean.toUpperCase();

  if (upper.includes('AUTO-FILLED')) return inspectorStr;

  const misreadMatch = Object.entries(HANDWRITING_MISREADS.inspector).find(([official, misreads]) => misreads.includes(upper));
  if (misreadMatch) return misreadMatch[0];

  const exact = SAC_CONFIG.OFFICIAL_CHECKERS.find(checker => normalizeInspectorForMatch_(upper).includes(normalizeInspectorForMatch_(checker)));
  if (exact) return exact;

  const scored = SAC_CONFIG.OFFICIAL_CHECKERS.map((checker) => ({
    cand: checker,
    score: similarity_(normalizeInspectorForMatch_(upper), normalizeInspectorForMatch_(checker))
  })).sort((a, b) => b.score - a.score);

  const best = scored[0] || { cand: null, score: 0 };
  const second = scored[1] || { cand: null, score: 0 };

  if (!best.cand || best.score < SAC_CONFIG.INSPECTOR_MATCH_THRESHOLD) return 'UNKNOWN';
  if (second && (best.score - second.score) < SAC_CONFIG.INSPECTOR_MATCH_MARGIN_THRESHOLD) return 'UNKNOWN';
  return best.cand;
}

function normalizeRoomCandidate_(roomStr) {
  if (!roomStr) return '';

  const cleaned = String(roomStr).trim();
  const withoutLabels = cleaned.replace(/\b(ROOM|RM|BLDG|BUILDING|SAC|ENG|SCI|STC|FLOOR|LEVEL|NUMBER)\b/gi, '').trim();
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

// ========== VALIDATION & REVIEW FUNCTIONS ==========
function isFutureMonth(dateStr) {
  if (!dateStr) return false;
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return false;
  const month = parseInt(parts[0], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (isNaN(month) || isNaN(year)) return false;
  const today = new Date();
  if (year > today.getFullYear()) return true;
  return year === today.getFullYear() && month > today.getMonth();
}

function validateDateTime_(dateStr, timeStr) {
  const issues = [];
  if (!dateStr) {
    issues.push('date missing');
  } else {
    const parsed = enforceTargetYear(dateStr);
    const parts = parsed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!parts) issues.push('date unrecognized');
  }
  if (timeStr) {
    if (timeToMinutes(timeStr) === null) issues.push('time unrecognized');
  } else {
    issues.push('time missing');
  }
  return issues;
}

function checkNeedsReview(parsed, room) {
  const reasons = [];

  parsed.answers.forEach((a, i) => {
    if (a === 'Unclear') reasons.push(`Q${i + 1} unclear`);
  });

  if (!parsed.inspector) reasons.push('inspector missing');
  if (!parsed.date) reasons.push('date missing');
  if (!room) reasons.push('room missing');

  const roomMatch = getRoomMatchResult(room);
  if (!roomMatch.official) reasons.push(`ROOM UNRECOGNIZED: ${room}`);

  if (parsed.inspector) {
    const details = getInspectorMatchDetails(parsed.inspector);
    const pct = Math.round(details.score * 100);
    const isAutoFilled = String(parsed.inspector).toUpperCase().includes('AUTO-FILLED');
    const ambiguous = details.secondBest && ((details.score - details.margin) < SAC_CONFIG.INSPECTOR_MATCH_MARGIN_THRESHOLD);
    if (!details.match || details.score < SAC_CONFIG.INSPECTOR_MATCH_THRESHOLD || ambiguous) {
      if (!isAutoFilled) {
        reasons.push(`Inspector low-confidence (${pct}%): ${parsed.inspector}`);
      }
    }
  }

  const dtIssues = validateDateTime_(parsed.date, parsed.time);
  dtIssues.forEach(i => reasons.push(i));

  if (parsed.date && parsed.date.includes('01-01-2026')) {
    reasons.push('date likely misread');
  }

  return reasons.length ? reasons.join('; ') : null;
}

// ========== DATA PROCESSING FUNCTIONS ==========
function appendParsedRoomsToSheet_(parsed, fileName, sheet, existingSignatures) {
  const rooms = expandRoomRangeSAC(parsed.room);
  const rowsToAppend = [];
  let appendedAny = false;
  let needsReview = false;

  rooms.forEach(room => {
    const reviewReason = checkNeedsReview(parsed, room);
    const row = buildSacRow(parsed, fileName, reviewReason, room);
    const signature = buildRecordSignature_(row);
    if (existingSignatures.has(signature)) return;

    existingSignatures.add(signature);
    rowsToAppend.push(row);
    appendedAny = true;
    if (reviewReason) needsReview = true;
  });

  if (rowsToAppend.length) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }
  SpreadsheetApp.flush();
  return { appendedAny, needsReview };
}

function expandRoomRangeSAC(roomStr) {
  if (!roomStr) return [''];
  const clean = extractPureRoomNumber(roomStr);
  const rangeMatch = clean.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    const pad = rangeMatch[1].length;
    if (start <= end && end - start <= SAC_CONFIG.MAX_ROOM_RANGE_SPAN) {
      const rooms = [];
      for (let i = start; i <= end; i++) rooms.push(String(i).padStart(pad, '0'));
      return rooms;
    }
  }
  if (clean.includes(',')) {
    return clean.split(',').map(r => extractPureRoomNumber(r)).filter(Boolean);
  }
  return [clean];
}

function scoreAndCountsSAC(answers) {
  const totalYes = answers.filter(a => a === 'Yes').length;
  const totalNo = answers.filter(a => a === 'No').length;
  return { score: `${totalYes * 10} / ${SAC_CONFIG.MAX_SCORE_PER_AUDIT}`, totalYes, totalNo };
}

function formattedNowSAC() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function buildSacRow(parsed, fileName, reviewReason, customRoom) {
  const roomValue = extractPureRoomNumber(customRoom || parsed.room || '');
  const inspectorValue = getOfficialInspector(parsed.inspector);
  const sc = scoreAndCountsSAC(parsed.answers);
  const finalDateTime = `${parsed.date || `${SAC_CONFIG.TARGET_YEAR_FULL}-01-01`}${parsed.time ? ` ${parsed.time}` : ''}`;
  const campusDisplay = normalizeCampus_(parsed.campus, roomValue);

  return [
    formattedNowSAC(), sc.score, finalDateTime, campusDisplay, roomValue,
    parsed.answers[0], parsed.answers[1], parsed.answers[2], parsed.answers[3],
    parsed.answers[4], parsed.answers[5], parsed.answers[6], parsed.teacherName || parsed.teacher_name || '',
    parsed.answers[7], parsed.comment || '', inspectorValue,
    sc.totalYes, sc.totalNo, fileName || '', reviewReason ? 'NEEDS REVIEW: ' + reviewReason : 'PASSED'
  ];
}

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
    .map((v) => String(v).trim())
    .join('|')
    .toLowerCase();
}

function normalizeCampus_(campusRaw, room) {
  const campus = String(campusRaw || '').toUpperCase();
  if (campus.includes('ENG')) return 'SAC ENG';
  const pure = String(room || '').replace(/\D/g, '');
  if (pure && SAC_CONFIG.SAC_EENG_ROOMS.includes(pure) && !SAC_CONFIG.SAC_ROOMS.includes(pure)) return 'SAC ENG';
  return 'SAC';
}

// ========== UTILITY FUNCTIONS ==========
function levenshteinDistance_(a, b) {
  a = String(a || ''); b = String(b || '');
  const al = a.length, bl = b.length;
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

function getOrCreateFolder(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function ensureSACSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  ensureMinColumns(sheet, HEADERS.length);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    styleHeaderRowGreen(sheet);
  }
  return sheet;
}

function loadExistingSignatures_(ss) {
  const signatures = new Set();
  ['SAC', 'SAC ENG'].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() <= 1) return;
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
    rows.forEach(row => signatures.add(buildRecordSignature_(row)));
  });
  return signatures;
}

function getPendingFilesSorted_(pendingFolder) {
  const iterator = pendingFolder.getFiles();
  const files = [];
  while (iterator.hasNext()) files.push(iterator.next());
  files.sort((a, b) => a.getName().localeCompare(b.getName()));
  return files;
}

function safeMoveTo_(file, destinationFolder) {
  try {
    file.moveTo(destinationFolder);
  } catch (err) {
    console.error('Could not move file "' + file.getName() + '":', err);
  }
}

function chooseTargetSheet_(ss, parsed) {
  const room = extractPureRoomNumber(parsed.room);
  const campusNorm = normalizeCampus_(parsed.campus, room);
  const sheetName = campusNorm === 'SAC ENG' ? 'SAC ENG' : 'SAC';
  return ensureSACSheet(ss, sheetName);
}

function getSACFolders_() {
  const root = DriveApp.getRootFolder();
  const building = getOrCreateFolder(root, SAC_CONFIG.FOLDER_NAMES.ROOT);
  return {
    building,
    pending: getOrCreateFolder(building, SAC_CONFIG.FOLDER_NAMES.PENDING),
    processed: getOrCreateFolder(building, SAC_CONFIG.FOLDER_NAMES.PROCESSED),
    review: getOrCreateFolder(building, SAC_CONFIG.FOLDER_NAMES.REVIEW),
    duplicate: getOrCreateFolder(building, SAC_CONFIG.FOLDER_NAMES.DUPLICATE),
    error: getOrCreateFolder(building, SAC_CONFIG.FOLDER_NAMES.FAILED)
  };
}

function finalizeSACRun_(ss, tally, startTime) {
  try {
    const sheetNames = ['SAC', 'SAC ENG'];
    for (let i = 0; i < sheetNames.length; i++) {
      const name = sheetNames[i];
      try {
        const sheet = ss.getSheetByName(name);
        if (sheet) {
          try { sortSheetByRoomNumberSAC(sheet); } catch (err) { console.error('Sorting skipped for', name, err); }
          try { styleHeaderRowGreen(sheet); } catch (err) { console.error('Styling header skipped for', name, err); }
        }
      } catch (err) {
        console.error('Post-scan per-sheet cleanup failed for', name, err);
      }
    }
  } catch (err) {
    console.error('Post-scan sort/style failed:', err);
  }

  try {
    generateRoomSummarySAC(ss);
    ss.toast('?? SAC summaries updated.', 'Summary', 5);
  } catch (err) {
    ss.toast('?? Summary generation failed: ' + err, 'Error', 10);
  }

  const runtimeSeconds = Math.round((Date.now() - startTime) / 1000);
  addLogEntry(ss, tally.processed, tally.review, tally.duplicate, tally.error, runtimeSeconds);
  ss.toast('SAC Done. P:' + tally.processed + ' R:' + tally.review + ' D:' + tally.duplicate + ' E:' + tally.error, 'Scan Complete', 5);
}

function addLogEntry(ss, processed, review, duplicate, errors, runtimeSeconds) {
  const logSheet = ss.getSheetByName(SAC_CONFIG.RUN_LOG_SHEET_NAME) || ss.insertSheet(SAC_CONFIG.RUN_LOG_SHEET_NAME);
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['Timestamp', 'Processed', 'Needs Review', 'Duplicates', 'Errors', 'Runtime (s)']);
  }
  logSheet.appendRow([new Date(), processed, review, duplicate, errors, runtimeSeconds]);
}

function logOCRError(ss, fileName, error) {
  const logSheet = ss.getSheetByName('OCR Errors') || ss.insertSheet('OCR Errors');
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['Timestamp', 'File Name', 'Error']);
  }
  logSheet.appendRow([new Date(), fileName, error]);
}

function lookupSACScheduledChecker(dateStr, timeStr, roomStr, campusStr) {
  if (!dateStr) return [];
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const cleanDate = enforceTargetYear(dateStr);
  const parts = cleanDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const dateObj = parts ? new Date(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10)) : new Date(cleanDate);
  if (isNaN(dateObj.getTime())) return [];

  const daySchedule = SAC_CHECKER_SCHEDULE.find(s => s.day === days[dateObj.getDay()]);
  if (!daySchedule) return [];

  const cleanRoom = extractPureRoomNumber(roomStr);
  const rawNum = cleanRoom.replace(/\D/g, '');
  let areaKey = 'sac';
  if (campusStr && campusStr.toUpperCase().includes('ENG')) areaKey = 'sac_eeng';
  else if (SAC_CONFIG.SAC_EENG_ROOMS.includes(rawNum) && !SAC_CONFIG.SAC_ROOMS.includes(rawNum)) areaKey = 'sac_eeng';

  const matches = [];
  const targetMin = timeToMinutes(timeStr);

  daySchedule.shifts.forEach(shift => {
    shift.slots.forEach(slot => {
      let isTimeMatch = false;
      if (!targetMin) isTimeMatch = true;
      else {
        const slotParts = slot.time.split('-');
        if (slotParts.length === 2) {
          const start = timeToMinutes(slotParts[0]);
          const end = timeToMinutes(slotParts[1]);
          if (start !== null && end !== null) isTimeMatch = targetMin >= start && targetMin <= end;
        }
      }
      if (isTimeMatch && slot.assignments && slot.assignments[areaKey]) {
        const asg = slot.assignments[areaKey];
        if (asg.assigned && !matches.includes(asg.assigned)) matches.push(asg.assigned);
        if (asg.partner && !matches.includes(asg.partner)) matches.push(asg.partner);
      }
    });
  });
  return matches;
}

// ========== SHEET SORTING & GROUPING ==========
function cleanExistingRoomsInSheet() {
  const ss = getTargetSpreadsheet();
  ['SAC', 'SAC ENG'].forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return;
    const range = sheet.getRange(2, COLUMNS.ROOM + 1, sheet.getLastRow() - 1, 1);
    const values = range.getValues().map(row => [row[0] ? extractPureRoomNumber(row[0]) : '']);
    try { range.setNumberFormat('@'); } catch (e) {}
    range.setValues(values);
  });
  SpreadsheetApp.flush();
}

function sortSACSheetNow() {
  const ss = getTargetSpreadsheet();
  ['SAC', 'SAC ENG'].forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      sortSheetByRoomNumberSAC(sheet);
      styleHeaderRowGreen(sheet);
    }
  });
}

function getFloorFromRoom(room) {
  const pure = String(room || '').replace(/\D/g, '');
  if (!pure) return '';
  return pure.charAt(0);
}

function clearAllRowGroups(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return;
  const maxRows = sheet.getMaxRows();
  for (let depth = 0; depth < 5; depth++) {
    try { sheet.getRange(1, 1, maxRows, 1).ungroupRow(); } catch (e) { break; }
  }
}

function groupRowsByRoomNumber(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2) return;
  try {
    clearAllRowGroups(sheet);
    // REMOVED: sheet.setRowGroupControlPosition(SpreadsheetApp.GroupControlPosition.BEFORE);
    const values = sheet.getRange(2, COLUMNS.CAMPUS + 1, lastRow - 1, 2).getValues();
    let startRow = 2;
    let currentCampus = String(values[0][0] || '').trim();
    let currentFloor = getFloorFromRoom(values[0][1]);
    for (let i = 1; i < values.length; i++) {
      const campus = String(values[i][0] || '').trim();
      const floor = getFloorFromRoom(values[i][1]);
      if (campus !== currentCampus || floor !== currentFloor) {
        const endRow = i + 1;
        if (endRow > startRow) {
          try { sheet.getRange(startRow + 1, 1, endRow - startRow, 1).shiftRowGroupDepth(1); } catch (e) {}
        }
        startRow = endRow;
        currentCampus = campus;
        currentFloor = floor;
      }
    }
    const endRow = values.length + 1;
  if (endRow > startRow) {
    try { 
      sheet.getRange(startRow + 1, 1, endRow - startRow, 1).shiftRowGroupDepth(1); 
    } catch (e) {}
  }

  try { 
    sheet.collapseAllRowGroups(); 
  } catch (e) {}

} catch (e) {
  console.error('Row grouping bypassed:', e);
}
}

function sortSheetByRoomNumberSAC(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  const lastCol = sheet.getLastColumn();
  const roomRange = sheet.getRange(2, COLUMNS.ROOM + 1, lastRow - 1, 1);
  const roomValues = roomRange.getValues().map(row => [row[0] ? extractPureRoomNumber(row[0]) : '']);
  try { roomRange.setNumberFormat('@'); } catch (e) { console.warn('Could not set number format for room column:', e); }
  try {
    roomRange.setValues(roomValues);
  } catch (e) {
    console.warn('Could not set room values (skipping):', e);
  }
  try { SpreadsheetApp.flush(); } catch (e) { console.warn('Flush failed (continuing):', e); }
  try {
    sheet.getRange(2, 1, lastRow - 1, lastCol).sort([
      { column: COLUMNS.CAMPUS + 1, ascending: true },
      { column: COLUMNS.ROOM + 1, ascending: true },
      { column: COLUMNS.DATE_TIME + 1, ascending: true }
    ]);
  } catch (e) {
    console.error('Sorting bypassed:', e);
  }
  groupRowsByRoomNumber(sheet);
}

// ========== SUMMARY GENERATION ==========
function generateRoomSummarySACNow() {
  generateRoomSummarySAC(getTargetSpreadsheet());
}

function refreshSummariesOnly() {
  const ss = getTargetSpreadsheet();
  if (!ss) return;
  generateRoomSummarySAC(ss);
  SpreadsheetApp.getUi().alert('Summaries refreshed.');
}

function extractMonthKey(dateVal) {
  if (!dateVal) return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM yyyy');
  const str = String(dateVal).trim();
  const match = str.match(/(\d{4})[-/](\d{1,2})/);
  if (match) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const num = parseInt(match[2], 10);
    if (num >= 1 && num <= 12) return `${months[num - 1]} ${match[1]}`;
  }
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM yyyy');
}

function defaultMonthKey_() {
  return `Jul ${SAC_CONFIG.TARGET_YEAR_FULL}`;
}

function aggregateSummaryData(dataRows) {
  const map = {};
  dataRows.forEach(row => {
    const raw = String(row[COLUMNS.ROOM] || '');
    const officialRoom = getOfficialRoom(raw);
    const room = officialRoom === 'UNKNOWN' ? 'UNKNOWN' : officialRoom;
    if (!map[room]) map[room] = { room, audits: 0, yes: 0, no: 0, questionCounts: {} };
    map[room].audits += 1;
    map[room].yes += Number(row[COLUMNS.TOTAL_YES]) || 0;
    map[room].no += Number(row[COLUMNS.TOTAL_NO]) || 0;
    ['Q1','Q2','Q3','Q4','Q5','Q6','Q7_TEACHER','Q8'].forEach(q => {
      const value = String(row[COLUMNS[q]] || '').trim();
      if (!map[room].questionCounts[q]) map[room].questionCounts[q] = { Yes: 0, No: 0, Unclear: 0 };
      if (value === 'Yes' || value === 'No' || value === 'Unclear') map[room].questionCounts[q][value] += 1;
    });
  });
  return map;
}

function generateRoomSummarySAC(ss) {
  const monthlyMap = {};
  ['SAC', 'SAC ENG'].forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return;
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    rows.forEach(row => {
      const monthKey = extractMonthKey(row[COLUMNS.DATE_TIME]);
      if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { sac: [], eng: [] };
      const campus = String(row[COLUMNS.CAMPUS] || '').toUpperCase();
      if (sheetName === 'SAC ENG' || campus.includes('ENG')) monthlyMap[monthKey].eng.push(row);
      else monthlyMap[monthKey].sac.push(row);
    });
  });

  let months = Object.keys(monthlyMap).length ? Object.keys(monthlyMap) : [];
  if (!months.length) {
    const year = SAC_CONFIG.TARGET_YEAR_FULL;
    months = ['Jul','Aug','Sep','Oct','Nov','Dec'].map(m => `${m} ${year}`);
    months.forEach(m => { monthlyMap[m] = { sac: [], eng: [] }; });
  }

  removeExistingSummarySheets_(ss);

  months.forEach(monthKey => {
    const sacTab = `Summary - SAC - ${monthKey}`;
    const engTab = `Summary - ENG - ${monthKey}`;

    // SAC summary sheet
    const sacSheet = ss.getSheetByName(sacTab) || ss.insertSheet(sacTab);
    sacSheet.clear();
    sacSheet.getCharts().forEach(chart => sacSheet.removeChart(chart));
    let row = 1;
    sacSheet.getRange(row, 1).setValue(`?? SAC BUILDING MONITORING (${monthKey.toUpperCase()})`).setFontWeight('bold').setFontSize(13).setFontColor('#1B5E20');
    row += 2;
    row = renderBuildingSummarySection(sacSheet, aggregateSummaryData(monthlyMap[monthKey].sac), row, `SAC Building (${monthKey}): Total YES vs NO by Room`, '#2E7D32', '#2E7D32', '#C62828');
    row += 2;
    row = renderQuestionChartsSection(sacSheet, aggregateSummaryData(monthlyMap[monthKey].sac), row, `SAC Building (${monthKey}) Question Responses`, '#2E7D32', ['#2E7D32', '#C62828', '#F9A825']);
    sacSheet.autoResizeColumns(1, 6);

    // Engineering summary sheet
    const engSheet = ss.getSheetByName(engTab) || ss.insertSheet(engTab);
    engSheet.clear();
    engSheet.getCharts().forEach(chart => engSheet.removeChart(chart));
    row = 1;
    engSheet.getRange(row, 1).setValue(`?? ENGINEERING BUILDING MONITORING (${monthKey.toUpperCase()}) - (NOT SAC MAIN BLDG)`).setFontWeight('bold').setFontSize(13).setFontColor('#0D47A1');
    row += 2;
    row = renderBuildingSummarySection(engSheet, aggregateSummaryData(monthlyMap[monthKey].eng), row, `Engineering (${monthKey}): Total YES vs NO by Room`, '#0D47A1', '#0D47A1', '#C62828');
    row += 2;
    renderQuestionChartsSection(engSheet, aggregateSummaryData(monthlyMap[monthKey].eng), row, `Engineering (${monthKey}) Question Responses`, '#0D47A1', ['#0D47A1', '#C62828', '#F9A825']);
    engSheet.autoResizeColumns(1, 6);
  });
}

function renderBuildingSummarySection(sheet, summaryMap, startRow, chartTitle, headerColor, yesColor, noColor) {
  const headers = ['Room Number', 'Total Audits', 'Total YES', 'Total NO', 'Compliance Score (%)'];
  const roomKeys = Object.keys(summaryMap).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const tableData = roomKeys.map(room => {
    const item = summaryMap[room];
    const maxScore = item.audits * SAC_CONFIG.MAX_SCORE_PER_AUDIT;
    const pct = maxScore > 0 ? `${Math.round((item.yes * 10 / maxScore) * 100)}%` : '0%';
    return [item.room, item.audits, item.yes, item.no, pct];
  });

  if (!tableData.length) {
    sheet.getRange(startRow, 1, 1, headers.length).setValues([['No scans recorded', '-', '-', '-', '-']]);
    return startRow + 2;
  }

  sheet.getRange(startRow, 1, 1, headers.length).setValues([headers]).setBackground(headerColor).setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(startRow + 1, 1, tableData.length, headers.length).setValues(tableData);
  try {
    sheet.getRange(startRow + 1, 1, tableData.length, 1).setNumberFormat('@');
    sheet.getRange(startRow + 1, 2, tableData.length, 3).setNumberFormat('0');
  } catch (e) {}

  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(startRow, 1, tableData.length + 1, 1))
    .addRange(sheet.getRange(startRow, 3, tableData.length + 1, 2))
    .setPosition(startRow, 7, 0, 0)
    .setOption('title', chartTitle)
    .setOption('hAxis', { title: 'Room Number', textStyle: { fontSize: 10 } })
    .setOption('vAxis', { title: 'Answer Tally', format: '0' })
    .setOption('legend', { position: 'top' })
    .setOption('colors', [yesColor, noColor])
    .setOption('series', { 0: { labelInLegend: 'Total YES', color: yesColor }, 1: { labelInLegend: 'Total NO', color: noColor } })
    .setOption('width', 700)
    .setOption('height', 360)
    .setOption('useFirstColumnAsDomain', true)
    .build();
  sheet.insertChart(chart);

  return startRow + tableData.length + 2;
}

function renderQuestionChartsSection(sheet, summaryMap, startRow, sectionTitle, headerColor, colors) {
  const roomKeys = Object.keys(summaryMap).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!roomKeys.length) {
    sheet.getRange(startRow, 1).setValue('No question data available for this section.');
    return startRow + 2;
  }

  const questionKeys = ['Q1','Q2','Q3','Q4','Q5','Q6','Q7_TEACHER','Q8'];
  let row = startRow;
  sheet.getRange(row, 1).setValue(sectionTitle).setFontWeight('bold').setFontSize(11);
  row += 1;

  questionKeys.forEach(questionKey => {
    const label = questionKey === 'Q7_TEACHER' ? 'Q7 (Teacher)' : questionKey;
    sheet.getRange(row, 1).setValue(label).setFontWeight('bold');
    row += 1;

    const headers = ['Room', 'Yes', 'No', 'Unclear'];
    sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setBackground(headerColor).setFontColor('#FFFFFF').setFontWeight('bold');
    row += 1;

    const tableRows = roomKeys.map(room => {
      const counts = summaryMap[room].questionCounts[questionKey] || { Yes: 0, No: 0, Unclear: 0 };
      return [room, counts.Yes, counts.No, counts.Unclear];
    });

    sheet.getRange(row, 1, tableRows.length, headers.length).setValues(tableRows);
    sheet.getRange(row, 1, tableRows.length, 1).setNumberFormat('@');
    sheet.getRange(row, 2, tableRows.length, 3).setNumberFormat('0');

    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sheet.getRange(row - 1, 1, tableRows.length + 1, headers.length))
      .setPosition(row, 7, 0, 0)
      .setOption('title', `${label} response counts`)
      .setOption('hAxis', { title: 'Room', textStyle: { fontSize: 10 } })
      .setOption('vAxis', { title: 'Count', format: '0' })
      .setOption('legend', { position: 'top' })
      .setOption('colors', colors)
      .setOption('series', { 0: { labelInLegend: 'Yes', color: colors[0] }, 1: { labelInLegend: 'No', color: colors[1] }, 2: { labelInLegend: 'Unclear', color: colors[2] } })
      .setOption('width', 650)
      .setOption('height', 320)
      .setOption('useFirstColumnAsDomain', true)
      .build();
    sheet.insertChart(chart);

    row += tableRows.length + 4;
  });

  return row;
}

function removeExistingSummarySheets_(ss) {
  try {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const name = sheets[i].getName();
      if (name.indexOf('Summary - SAC -') === 0 || name.indexOf('Summary - ENG -') === 0) {
        try { ss.deleteSheet(sheets[i]); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    console.error('Failed to remove existing summary sheets:', e);
  }
}