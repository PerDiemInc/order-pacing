# Publishing to npm

This guide explains how to publish this package to the public npm registry.

## Prerequisites

1. **npm account** with access to the `@perdieminc` organization
2. **Authenticate with npm**:

```bash
npm login
```

Or use an automation token:

```bash
npm config set //registry.npmjs.org/:_authToken YOUR_NPM_TOKEN
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

3. **Run tests**:

```bash
npm test
```

4. **Update version** (if needed):

```bash
npm version patch  # for bug fixes
npm version minor  # for new features
npm version major  # for breaking changes
```

5. **Publish to npm**:

```bash
npm publish
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
