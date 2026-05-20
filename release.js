const { execSync } = require('child_process');
require('dotenv').config();

if (!process.env.GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN is not set in .env file');
  process.exit(1);
}

console.log('Building and publishing release to GitHub...');

try {
  console.log('Phase 1: Building main and renderer...');
  execSync('npm run build', { stdio: 'inherit' });

  console.log('Phase 2: Packaging and publishing to GitHub...');
  execSync(`npx cross-env GITHUB_TOKEN=${process.env.GITHUB_TOKEN} npx electron-builder build --win --publish always`, {
    stdio: 'inherit'
  });
  console.log('Release published successfully!');
} catch (error) {
  console.error('Failed to publish release:', error.message);
  process.exit(1);
}
