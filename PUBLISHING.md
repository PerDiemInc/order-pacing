# Publishing to npm

This package uses automated publishing via GitHub Actions. The workflow automatically publishes to npm and creates a GitHub Release when you push a version tag.

## Automated Publishing (Recommended)

The package is automatically published when you push a version tag. The workflow:

1. Runs when you push a version tag (e.g., `v0.0.4`, `v0.1.0`)
2. Publishes the package to npm registry using Trusted Publisher (OIDC)
3. Creates a GitHub Release with auto-generated release notes

### How to Publish

1. **Update version and create tag**:

```bash
npm version patch  # for bug fixes
npm version minor  # for new features
npm version major  # for breaking changes
```

2. **Push the tag**:

```bash
git push origin master --follow-tags
```

The GitHub Actions workflow will automatically:
- Build the package
- Run tests
- Publish to npm
- Create a GitHub Release

### Prerequisites

- Trusted Publisher (OIDC) configured on npm for the `@perdieminc` organization
- GitHub Actions environment `npm-publish` configured with the npm package URL

## Manual Publishing

If you need to publish manually:

1. **Build the package**:

```bash
npm run build
```

2. **Run tests**:

```bash
npm test
```

3. **Publish to npm**:

```bash
npm publish --access public
```

## Installing the Package

To install this package in other projects:

```bash
npm install @perdieminc/order-pacing
```

## Troubleshooting

### 401 Unauthorized

- Make sure you're logged in with `npm login`
- Verify you have access to publish to the `@perdieminc` organization
- Check that your npm token hasn't expired

### Package Already Exists

If you need to republish:
- Bump the version using `npm version patch/minor/major`
- Or unpublish the existing version (if within 72 hours): `npm unpublish @perdieminc/order-pacing@version`

## Verifying Publication

After publishing, you can view your package at:
https://www.npmjs.com/package/@perdieminc/order-pacing
