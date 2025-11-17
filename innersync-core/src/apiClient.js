const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

async function uploadTimetable({
  apiBaseUrl,
  apiToken,
  login,
  tokenCachePath,
  files,
  logger = console,
}) {
  const baseUrl = apiBaseUrl || 'https://innersync.com.au';

  const resolvedFiles = normalizeFileMap(files);
  const missing = Object.entries(resolvedFiles)
    .filter(([, filePath]) => !filePath)
    .map(([field]) => field);
  if (missing.length) {
    logger.warn(`[sync] missing file paths for: ${missing.join(', ')}`);
    return { skipped: true, reason: 'missing files' };
  }

  const [studentCourse, studentTimetable, timetable] = await Promise.all(
    Object.values(resolvedFiles).map((filePath) =>
      fs.readFile(filePath).then((buffer) => ({ filePath, buffer }))
    )
  );

  const payloadHash = crypto.createHash('sha256');
  for (const item of [studentCourse, studentTimetable, timetable]) {
    payloadHash.update(item.buffer);
  }
  const combinedHash = payloadHash.digest('hex');

  const token =
    apiToken ||
    (await getCachedToken(tokenCachePath)) ||
    (await loginForToken(baseUrl, login, tokenCachePath, logger));

  if (!token) {
    logger.warn('[sync] No API token available; upload skipped');
    return { skipped: true, reason: 'no token' };
  }

  const endpoint = buildUrl(baseUrl, '/api/timetable-sync');
  const form = new FormData();
  appendBuffer(form, 'student_course', studentCourse);
  appendBuffer(form, 'student_timetable', studentTimetable);
  appendBuffer(form, 'timetable', timetable);
  form.append('payload_hash', combinedHash);

  logger.log('[sync] uploading timetable files', {
    endpoint,
    payloadHash: combinedHash,
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: form,
  });

  if (response.status === 401 && !apiToken) {
    // Token expired: clear cache and retry once.
    await clearCachedToken(tokenCachePath);
    return uploadTimetable({
      apiBaseUrl: baseUrl,
      apiToken: null,
      login,
      tokenCachePath,
      files: resolvedFiles,
      logger,
    });
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    logger.error('[sync] upload failed', {
      status: response.status,
      body: payload,
    });
    throw new Error(`Upload failed with status ${response.status}`);
  }

  logger.log('[sync] upload completed', payload);
  const message = payload?.message || null;
  const isSkippedResponse = payload?.status === 'skipped';
  return {
    status: response.status,
    body: payload,
    payloadHash: combinedHash,
    skipped: Boolean(isSkippedResponse),
    message,
    reason: message,
  };
}

function normalizeFileMap(files = {}) {
  if (Array.isArray(files)) {
    const [student_course, student_timetable, timetable] = files;
    return { student_course, student_timetable, timetable };
  }
  return files;
}

function getExpectedFilename(fieldName) {
  switch (fieldName) {
    case 'student_course':
      return 'StudentCourse.csv';
    case 'student_timetable':
      return 'StudentTimetable.csv';
    case 'timetable':
      return 'Timetable.csv';
    default:
      return null;
  }
}

function appendBuffer(form, fieldName, { buffer, filePath }) {
  const expectedName = getExpectedFilename(fieldName);
  const filename = expectedName || path.basename(filePath);
  const blob = new Blob([buffer]);
  form.append(fieldName, blob, filename);
}

function buildUrl(base, relativePath) {
  return new URL(relativePath, base).toString();
}

async function loginForToken(apiBaseUrl, loginConfig = {}, tokenCachePath, logger) {
  const loginEndpoint = buildUrl(apiBaseUrl, '/api/login');
  const payload = {
    email: loginConfig.email,
    password: loginConfig.password,
    device_name: loginConfig.device_name || 'electron-sync',
    replace_existing: loginConfig.replace_existing ?? true,
  };

  if (!payload.email || !payload.password) {
    logger.warn('[sync] login credentials missing; cannot fetch token');
    return null;
  }

  logger.log('[sync] requesting API token...', { loginEndpoint });
  const response = await fetch(loginEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error('[sync] login failed', { status: response.status, body: text });
    throw new Error(`Login failed with status ${response.status}`);
  }

  const data = await response.json();
  if (tokenCachePath && data?.token) {
    await cacheToken(tokenCachePath, data.token);
  }
  return data?.token || null;
}

async function cacheToken(tokenCachePath, token) {
  if (!tokenCachePath) return;
  const fullPath = path.resolve(__dirname, '..', tokenCachePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify({ token }), 'utf8');
}

async function getCachedToken(tokenCachePath) {
  if (!tokenCachePath) return null;
  try {
    const fullPath = path.resolve(__dirname, '..', tokenCachePath);
    const raw = await fs.readFile(fullPath, 'utf8');
    const data = JSON.parse(raw);
    return data.token || null;
  } catch (error) {
    return null;
  }
}

async function clearCachedToken(tokenCachePath) {
  if (!tokenCachePath) return;
  try {
    const fullPath = path.resolve(__dirname, '..', tokenCachePath);
    await fs.unlink(fullPath);
  } catch (error) {
    // ignore
  }
}

module.exports = {
  uploadTimetable,
  loginForToken,
  clearCachedToken,
};
