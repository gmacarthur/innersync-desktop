#!/usr/bin/env node
const path = require('path');
const { generateTimetable } = require('./generate');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseDir = path.resolve(
    args.baseDir || path.join(__dirname, '..', '..')
  );
  const tfxFile = args.tfx
    ? path.resolve(process.cwd(), args.tfx)
    : path.join(baseDir, 'Timetable.tfx');
  const outputDir = args.output
    ? path.resolve(process.cwd(), args.output)
    : path.join(baseDir, 'generated');

  await generateTimetable({
    baseDir,
    tfxFile,
    outputDir,
    logger: console,
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
