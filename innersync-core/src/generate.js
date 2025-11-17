const fs = require('fs/promises');
const path = require('path');

async function generateTimetable(options = {}) {
  const logger = options.logger || console;
  const baseDir = options.baseDir
    ? path.resolve(options.baseDir)
    : path.join(__dirname, '..', '..');
  const tfxPath = options.tfxFile
    ? path.isAbsolute(options.tfxFile)
      ? options.tfxFile
      : path.resolve(baseDir, options.tfxFile)
    : path.join(baseDir, 'Timetable 2026.tfx');
  const outputDir = options.outputDir
    ? path.isAbsolute(options.outputDir)
      ? options.outputDir
      : path.resolve(baseDir, options.outputDir)
    : path.join(baseDir, 'generated');

  logger.log?.(`Reading timetable: ${tfxPath}`);
  const raw = await fs.readFile(tfxPath, 'utf8');
  const data = JSON.parse(raw);

  const lookups = buildLookups(data);
  await fs.mkdir(outputDir, { recursive: true });

  const studentCoursePath = path.join(outputDir, 'StudentCourse.txt');
  const studentTimetablePath = path.join(outputDir, 'StudentTimetable.txt');
  const timetablePath = path.join(outputDir, 'Timetable.txt');

  const timetableRows = buildTimetableRows(data.Timetable || [], lookups);

  await writeStudentCourse(studentCoursePath, data.Students || []);
  await writeStudentTimetable(studentTimetablePath, data.Students || []);
  await writeMasterTimetable(timetablePath, timetableRows);

  logger.log?.(`StudentCourse -> ${studentCoursePath}`);
  logger.log?.(`StudentTimetable -> ${studentTimetablePath}`);
  logger.log?.(`Timetable -> ${timetablePath}`);

  return {
    studentCoursePath,
    studentTimetablePath,
    timetablePath,
    outputDir,
  };
}

function buildLookups(data) {
  const days = new Map();
  (data.Days || []).forEach((day, index) => {
    days.set(day.DayID, { ...day, order: index + 1 });
  });

  const periods = new Map();
  (data.Periods || []).forEach((period) => {
    periods.set(period.PeriodID, period);
  });

  const classNames = new Map();
  (data.ClassNames || []).forEach((cls) => {
    classNames.set(cls.ClassNameID, cls);
  });

  const rollClasses = new Map();
  (data.RollClasses || []).forEach((roll) => {
    rollClasses.set(roll.RollClassID, roll);
  });

  const yearLevels = new Map();
  (data.YearLevels || []).forEach((year) => {
    yearLevels.set(year.YearLevelID, year);
  });

  const teachers = new Map();
  (data.Teachers || []).forEach((teacher) => {
    teachers.set(teacher.TeacherID, teacher);
  });

  const rooms = new Map();
  (data.Rooms || []).forEach((room) => {
    rooms.set(room.RoomID, room);
  });

  return {
    days,
    periods,
    classNames,
    rollClasses,
    yearLevels,
    teachers,
    rooms,
  };
}

async function writeStudentCourse(filePath, students) {
  const seen = new Set();
  for (const student of students) {
    const year = safeYear(student.YearLevel);
    for (const lesson of student.StudentLessons || []) {
      const classCode = lesson.ClassCode?.trim();
      if (!classCode) continue;
      seen.add(`${year}::${classCode}`);
    }
  }

  const rows = Array.from(seen)
    .map((entry) => {
      const [year, classCode] = entry.split('::');
      return { year, classCode };
    })
    .sort((a, b) => {
      if (a.year === b.year) return a.classCode.localeCompare(b.classCode);
      return a.year.localeCompare(b.year);
    });

  const content = rows.map((row) => csvRow([row.year, row.classCode])).join('');
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeStudentTimetable(filePath, students) {
  const lines = [];
  for (const student of students) {
    const year = safeYear(student.YearLevel);
    const lessonSet = new Set();
    for (const lesson of student.StudentLessons || []) {
      const code = lesson.ClassCode?.trim();
      if (code) lessonSet.add(code);
    }
    if (lessonSet.size === 0) continue;
    const classCodes = Array.from(lessonSet).sort((a, b) =>
      a.localeCompare(b)
    );
    const base = [
      student.LastName || '',
      student.FirstName || '',
      year,
      student.Code || '',
      student.House || '',
      student.HomeGroup || '',
    ];

    for (const classCode of classCodes) {
      lines.push(csvRow([...base, classCode]));
    }
  }

  await fs.writeFile(filePath, lines.join(''), 'utf8');
}

function buildTimetableRows(entries, lookups) {
  const rows = [];
  for (const entry of entries) {
    const period = lookups.periods.get(entry.PeriodID);
    if (!period) continue;
    const day = lookups.days.get(period.DayID);
    const className = lookups.classNames.get(entry.ClassNameID);
    if (!className) continue;
    const rollClass = lookups.rollClasses.get(entry.RollClassID);
    const yearLevel =
      rollClass && lookups.yearLevels.get(rollClass.YearLevelID);
    const yearCode = yearLevel?.Code;
    const teacherRequired = !className.TeacherNotRequired;
    const teacher =
      teacherRequired && entry.TeacherID
        ? lookups.teachers.get(entry.TeacherID)
        : null;
    const room =
      teacherRequired && entry.RoomID
        ? lookups.rooms.get(entry.RoomID)
        : null;

    rows.push({
      dayOrder: day?.order ?? 0,
      periodOrder: period.PeriodNo ?? 0,
      periodCode: period.Code || '',
      classCode: className.Code || '',
      year: yearCode ? safeYear(yearCode) : '',
      teacherCode: teacher?.Code || '',
      roomCode: room?.Code || '',
      dayName: day?.Name || '',
    });
  }

  return rows;
}

async function writeMasterTimetable(filePath, rows) {
  const content = rows
    .map((row) =>
      csvRow(
        row.year === '' && row.teacherCode === '' && row.roomCode === ''
          ? [
              String(row.dayOrder || ''),
              row.periodCode,
              row.classCode,
              row.year,
              row.teacherCode,
              row.dayName,
            ]
          : [
              String(row.dayOrder || ''),
              row.periodCode,
              row.classCode,
              row.year,
              row.teacherCode,
              row.roomCode,
              row.dayName,
            ]
      )
    )
    .join('');

  await fs.writeFile(filePath, content, 'utf8');
}

function csvRow(fields) {
  return `${fields
    .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
    .join(',')}\r\n`;
}

function safeYear(value) {
  if (!value && value !== 0) return '';
  const asString = String(value).padStart(2, '0');
  return asString;
}

module.exports = {
  generateTimetable,
};
