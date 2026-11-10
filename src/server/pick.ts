// Opens the Mac folder window and returns the folder the person chose.
// Tests set ORCS_FOLDER_PICK so the window never appears.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROMPT = 'Choose the project folder';

const MAC = `on run argv
  set promptText to item 1 of argv
  set startPath to item 2 of argv
  if startPath is "" then
    set picked to choose folder with prompt promptText
  else
    try
      set picked to choose folder with prompt promptText default location POSIX file startPath
    on error
      set picked to choose folder with prompt promptText
    end try
  end if
  return POSIX path of picked
end run
`;

export async function chooseFolder(start = ''): Promise<string | null> {
  if (process.env.ORCS_FOLDER_PICK !== undefined) {
    const forced = process.env.ORCS_FOLDER_PICK;
    if (!forced || forced === 'cancel') return null;
    return mustBeDir(forced);
  }
  if (process.platform !== 'darwin') throw new Error('The folder window is only available on this Mac. Type the path instead.');
  const begin = existingDir(start);
  const picked = await macDialog(begin);
  if (!picked) return null;
  return mustBeDir(picked);
}

function existingDir(start: string): string {
  if (!start) return '';
  try {
    const dir = path.resolve(start);
    return fs.statSync(dir).isDirectory() ? dir : '';
  } catch {
    return '';
  }
}

function mustBeDir(p: string): string {
  const dir = path.resolve(p.trim().replace(/\/+$/, '') || '/');
  let st: fs.Stats;
  try {
    st = fs.statSync(dir);
  } catch {
    throw new Error('That folder does not exist.');
  }
  if (!st.isDirectory()) throw new Error('Choose a folder, not a file.');
  return dir;
}

function macDialog(start: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-', PROMPT, start]);
    let out = '';
    let err = '';
    child.stdin.end(MAC);
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { err += c.toString('utf8'); });
    child.on('error', () => reject(new Error('The folder window could not open. Type the path instead.')));
    child.on('close', (code, signal) => {
      if (signal) return resolve(null);
      if (code === 0) return resolve(out.trim() || null);
      if (/User canceled|-128/i.test(err)) return resolve(null);
      reject(new Error('The folder window could not open. Type the path instead.'));
    });
  });
}
