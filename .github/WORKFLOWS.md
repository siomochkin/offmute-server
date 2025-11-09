# GitHub Actions Workflows

This repository uses GitHub Actions for automated CI/CD processes including building Docker images, versioning, and publishing to GitHub Container Registry.

## Workflows

### 1. Build and Publish Docker Image (`docker-publish.yml`)

**Triggers:**
- Push to `master` branch
- Push of tags matching `v*` pattern
- Pull requests to `master`
- Manual workflow dispatch

**What it does:**
- Builds multi-architecture Docker images (amd64, arm64)
- Publishes to both:
  - GitHub Container Registry (ghcr.io)
  - Harbor Registry (harbor.societycell.com)
- Creates multiple tags:
  - `latest` (for master branch)
  - Version from package.json (e.g., `0.1.6`)
  - Git SHA (e.g., `master-abc1234`)
  - Semantic version tags (e.g., `1.2.3`, `1.2`, `1`)
- Uses layer caching for faster builds
- Generates build attestation for security

**Docker Images Location:**
```bash
# GitHub Container Registry
ghcr.io/siomochkin/offmute-server:latest
ghcr.io/siomochkin/offmute-server:0.1.6
ghcr.io/siomochkin/offmute-server:master-abc1234

# Harbor Registry
harbor.societycell.com/societycell/offmute-server:latest
harbor.societycell.com/societycell/offmute-server:0.1.6
harbor.societycell.com/societycell/offmute-server:master-abc1234
```

### 2. Auto Tag on Push (`auto-tag.yml`)

**Triggers:**
- Push to `master` branch (except docs and config changes)
- Skips if commit message contains `[skip ci]`

**What it does:**
- Reads version from `package.json`
- Creates a git tag `v{version}` if it doesn't exist
- Creates a GitHub Release with Docker pull instructions
- Triggers the Docker build workflow via the new tag

**Example:**
When you push to master with version `0.1.6` in package.json:
1. Creates tag `v0.1.6`
2. Creates GitHub Release
3. Triggers Docker image build with tag `0.1.6`

### 3. Manual Version Bump (`version-bump.yml`)

**Triggers:**
- Manual workflow dispatch from GitHub Actions tab

**What it does:**
- Bumps version in `package.json` (patch/minor/major)
- Updates `package-lock.json`
- Commits changes with `[skip ci]` to avoid recursive builds
- Creates and pushes a new version tag
- Creates a GitHub Release
- Triggers Docker image build

**How to use:**
1. Go to Actions tab in GitHub
2. Select "Version Bump and Tag" workflow
3. Click "Run workflow"
4. Choose version bump type:
   - **patch**: `0.1.6` → `0.1.7` (bug fixes)
   - **minor**: `0.1.6` → `0.2.0` (new features)
   - **major**: `0.1.6` → `1.0.0` (breaking changes)
5. Click "Run workflow"

## Usage Examples

### Pulling Docker Images

```bash
# From GitHub Container Registry
docker pull ghcr.io/siomochkin/offmute-server:latest
docker pull ghcr.io/siomochkin/offmute-server:0.1.6
docker pull ghcr.io/siomochkin/offmute-server:master-abc1234

# From Harbor Registry
docker pull harbor.societycell.com/societycell/offmute-server:latest
docker pull harbor.societycell.com/societycell/offmute-server:0.1.6
docker pull harbor.societycell.com/societycell/offmute-server:master-abc1234
```

### Using with Docker Compose

```bash
# Use latest image
docker-compose up -d

# Use specific version
IMAGE_TAG=0.1.6 docker-compose up -d
```

Update your `docker-compose.yml`:
```yaml
services:
  offmute-api:
    image: ghcr.io/siomochkin/offmute-server:${IMAGE_TAG:-latest}
    # ... rest of config
```

## Versioning Strategy

### Automatic Versioning
1. Update version in `package.json` manually
2. Commit and push to master
3. Auto-tag workflow creates tag and release
4. Docker image is built and published automatically

### Manual Versioning
1. Use "Version Bump and Tag" workflow from GitHub Actions
2. Select bump type (patch/minor/major)
3. Everything else is automated

## Permissions Required

### GitHub Container Registry
The workflows use `GITHUB_TOKEN` which is automatically provided by GitHub Actions. No additional secrets needed for:
- Publishing to GitHub Container Registry
- Creating tags and releases
- Pushing to repository

### Harbor Registry
Required repository secrets (Settings → Secrets and variables → Actions):
- `HARBOR_USERNAME`: Your Harbor registry username
- `HARBOR_PASSWORD`: Your Harbor registry password

To set up Harbor secrets:
1. Go to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add `HARBOR_USERNAME` with your Harbor username
4. Add `HARBOR_PASSWORD` with your Harbor password

## Workflow Status Badges

Add these to your README.md:

```markdown
![Docker Publish](https://github.com/siomochkin/offmute-server/actions/workflows/docker-publish.yml/badge.svg)
![Auto Tag](https://github.com/siomochkin/offmute-server/actions/workflows/auto-tag.yml/badge.svg)
```

## Troubleshooting

### Docker image not building
- Check GitHub Actions logs in the Actions tab
- Verify Dockerfile is valid
- Ensure package.json has correct version format

### Tag already exists error
- The auto-tag workflow skips if tag exists
- Use version-bump workflow to increment version
- Or manually update version in package.json

### Permission denied errors
- Workflows use GITHUB_TOKEN with appropriate permissions
- Check repository settings → Actions → General → Workflow permissions
- Should be set to "Read and write permissions" 
