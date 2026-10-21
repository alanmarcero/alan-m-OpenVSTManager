import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file,'utf8')); }
  catch(error) { if(error.code==='ENOENT') return fallback; throw new Error(`Cannot read ${path.basename(file)}. Restore or rename this file and try again.`,{cause:error}); }
}
export async function writeJSON(file,value) {
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(temporary,file);
}
