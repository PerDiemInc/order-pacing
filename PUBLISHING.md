# Publishing to GitHub Packages

This guide explains how to publish this package to GitHub Packages as a private package.

## Prerequisites

1. **GitHub Personal Access Token (PAT)** with the following scopes:
   - `write:packages` - to publish packages
   - `read:packages` - to download packages
   - `delete:packages` - (optional) to delete package versions

   Create one at: https://github.com/settings/tokens/new

2. **Authenticate with GitHub Packages**:

```bash
export GITHUB_TOKEN=your_github_token_here
```

Or add it to your shell profile (~/.zshrc or ~/.bashrc):

```bash
echo 'export GITHUB_TOKEN=your_github_token_here' >> ~/.zshrc
source ~/.zshrc
```

## Publishing

1. **Build the package**:

```bash
npm run build
```

2. **Verify the build**:

```bash
ls -la lib/
```

Make sure all `.js` and `.d.ts` files are present.

3. **Update version** (if needed):

```bash
npm version patch  # for bug fixes
npm version minor  # for new features
npm version major  # for breaking changes
```

4. **Publish to GitHub Packages**:

```bash
npm publish
```

## Installing the Package

To install this private package in other projects:

1. **Create or update `.npmrc`** in the consuming project:

```
@perdieminc:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

2. **Install the package**:

```bash
npm install @perdieminc/busytime
```

## Troubleshooting

### 401 Unauthorized

- Make sure your `GITHUB_TOKEN` environment variable is set
- Verify the token has `write:packages` scope
- Check that the token hasn't expired

### 404 Not Found

- Verify the package name matches the GitHub organization: `@perdieminc/busytime`
- Ensure the repository exists at: https://github.com/PerDiemInc/busytime

### Package Already Exists

If you need to republish:
- Bump the version using `npm version patch/minor/major`
- Or delete the existing version from GitHub Packages UI

## Verifying Publication

After publishing, you can view your package at:
https://github.com/orgs/PerDiemInc/packages?repo_name=busytime

