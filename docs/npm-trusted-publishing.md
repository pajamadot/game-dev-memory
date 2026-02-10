# npm Trusted Publishing (GitHub OIDC) for `@pajamadot/pajama`

Goal: publish the npm package without storing long-lived npm tokens in CI.

This repo uses a GitHub Actions workflow:

- `.github/workflows/publish-pajama.yml`
- Trigger: push tag `pajama-vX.Y.Z`
- Publishes: `packages/pajama`

## One-time Setup (npm UI)

1. Publish the package once manually (requires OTP), so the package exists in npm:

```powershell
cd packages/pajama
npm publish --access public --otp <6-digit>
```

2. In npm package settings for `@pajamadot/pajama`, add a **Trusted Publisher**:

- Provider: GitHub Actions
- GitHub owner: `pajamadot`
- GitHub repo: `game-dev-memory`
- Workflow file path: `.github/workflows/publish-pajama.yml`

After this, the workflow can publish without OTP or npm tokens.

## Release Steps (Each Version)

1. Bump versions:

- `pajama/Cargo.toml`
- `packages/pajama/package.json`

2. Upload the prebuilt binary to R2:

```powershell
powershell -ExecutionPolicy Bypass -File .\\scripts\\release-pajama.ps1
```

3. Push a tag that matches the npm version:

```powershell
git tag pajama-vX.Y.Z
git push origin pajama-vX.Y.Z
```

The GitHub Action will:

- Verify tag matches `packages/pajama/package.json` version
- Verify the R2 download exists for the matching version
- Publish to npm using GitHub OIDC (Trusted Publishing)

