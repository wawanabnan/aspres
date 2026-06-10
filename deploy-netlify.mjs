import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SITE_ID = '826f5cda-4073-4b5f-89b5-00778231b836';
const TOKEN = 'nfp_UuCAsckjg7CL9nnpG5dEVoJZdAge2gai9d11';
const DIST = './dist';

async function main() {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(DIST);

  const fileObjs = files.map((f) => {
    const content = readFileSync(f);
    const sha = createHash('sha1').update(content).digest('hex');
    const rel = relative(DIST, f).replace(/\\/g, '/');
    return { path: rel, sha, content };
  });

  const required = {};
  for (const f of fileObjs) {
    required[f.path] = f.sha;
  }

  console.log('Total files:', fileObjs.length);

  const createRes = await fetch(
    `https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: required }),
    }
  );
  const deploy = await createRes.json();
  console.log('Deploy:', deploy.id, 'state:', deploy.state);

  const missing = deploy.required || [];
  console.log('Missing SHAs count:', missing.length);

  const shaToPath = {};
  for (const f of fileObjs) {
    shaToPath[f.sha] = f.path;
  }

  let uploaded = 0;
  for (const sha of missing) {
    const path = shaToPath[sha];
    if (!path) { console.log('Unknown SHA:', sha); continue; }
    const f = fileObjs.find(x => x.path === path);
    const putRes = await fetch(
      `https://api.netlify.com/api/v1/deploys/${deploy.id}/files/${path}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
        body: f.content,
      }
    );
    if (putRes.ok) {
      uploaded++;
      process.stdout.write('.');
    } else {
      const err = await putRes.text();
      console.log(`\nFailed: ${path} - ${putRes.status}: ${err}`);
    }
  }
  console.log(`\nUploaded ${uploaded} files`);

  const lockRes = await fetch(
    `https://api.netlify.com/api/v1/deploys/${deploy.id}/lock`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    }
  );
  const lockResult = await lockRes.json();
  console.log('Lock result:', lockResult.state);

  // Make this deploy the published one (retry loop)
  for (let attempt = 0; attempt < 10; attempt++) {
    const restoreRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys/${deploy.id}/restore`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      }
    );
    const restoreResult = await restoreRes.json();
    if (restoreResult.state === 'ready') {
      console.log('Restore result: ready');
      break;
    }
    console.log(`Restore attempt ${attempt + 1}: ${restoreResult.state || JSON.stringify(restoreResult)}, retrying in 2s...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('Site URL: https://aspres.netlify.app');
}

main().catch(console.error);
