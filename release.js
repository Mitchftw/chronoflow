const { execSync } = require('child_process');
const axios = require('axios');
const pkg = require('./package.json');
require('dotenv').config();

if (!process.env.GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN is not set in .env file');
  process.exit(1);
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = pkg.build?.publish?.owner || 'Mitchftw';
const REPO = pkg.build?.publish?.repo || 'chronoflow';
const VERSION = pkg.version;
const TAG = `v${VERSION}`;

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'ChronoFlow-Release-Script',
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findDraftRelease() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
  const response = await axios.get(url, { headers });
  const releases = response.data;
  return releases.find(
    (r) => (r.tag_name === TAG || r.name?.includes(VERSION)) && r.draft
  );
}

async function publishRelease(releaseId) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}`;
  const response = await axios.patch(url, { draft: false }, { headers });
  return response.data;
}

async function main() {
  console.log(`Starting release process for ChronoFlow ${TAG}...`);

  console.log('\n--- Phase 1: Building main and renderer ---');
  execSync('npm run build', { stdio: 'inherit' });

  console.log('\n--- Phase 2: Packaging and uploading draft release to GitHub ---');
  execSync(
    `npx cross-env GITHUB_TOKEN=${GITHUB_TOKEN} npx electron-builder build --win --publish always`,
    { stdio: 'inherit' }
  );

  console.log('\n--- Phase 3: Polling for draft release on GitHub ---');
  let draftRelease = null;
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    process.stdout.write(`Checking for draft release (attempt ${attempt}/${maxAttempts})... `);
    try {
      draftRelease = await findDraftRelease();
      if (draftRelease) {
        console.log(`Found draft release ID ${draftRelease.id}!`);
        console.log(`Assets uploaded: ${draftRelease.assets?.length || 0} files`);
        break;
      } else {
        console.log('Not ready yet.');
      }
    } catch (err) {
      console.log(`Error querying releases: ${err.message}`);
    }
    await sleep(4000);
  }

  if (!draftRelease) {
    console.error(`\nFailed to locate draft release for ${TAG} on GitHub after ${maxAttempts} attempts.`);
    process.exit(1);
  }

  console.log(`\n--- Phase 4: Publishing release ${TAG} ---`);
  const published = await publishRelease(draftRelease.id);
  console.log(`\nSuccess! Release ${TAG} published: ${published.html_url}`);
}

main().catch((err) => {
  console.error('\nRelease failed:', err.message);
  process.exit(1);
});
