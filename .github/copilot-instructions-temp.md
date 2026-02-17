# Copilot Instructions - Polina Shvedko Artist Website

## Project Overview

This is a static artist portfolio website for Polina Shvedko, showcasing artwork across three mediums: oil paintings, pastel drawings, and aquarelle (watercolor). The site is built with Mustache.js templates, processed by Gulp.js, and uses Tilda framework components for styling.

## Build & Development Commands

### Development
```bash
# Start development server (http://localhost:7000)
npm run server-start

# Start server with file watching and live reload
npm run server-watch

# Using Docker (recommended for consistent environment)
docker-compose up -d
docker ps  # Get container ID
docker exec -it <CONTAINER_ID> bash
npm run server-watch
```

### Build & Validation
```bash
# Full production build (processes all assets to /app directory)
npm run build

# Validate HTML output
npm run validate-html

# Optimize images
npm run image

# Generate sitemap
npm run sitemap
```

### Individual Gulp Tasks
```bash
gulp css      # Process CSS files
gulp babel    # Process JavaScript files
gulp html     # Compile Mustache templates
gulp img      # Optimize images
gulp fonts    # Copy webfonts
gulp watch    # Watch files with live reload
```

## Architecture

### Source vs Build Directories
- **`src/`** - Source files for development (edit these)
- **`app/`** - Generated files for production (don't edit directly)

All development work should be done in `src/`, and the Gulp build process generates output in `app/`.

### Template System (Mustache.js)

**Main Template**: `src/templates/index.html`  
**Partial Includes**: `src/templates/partials/`  
**Data Source**: `data.json` (root level, currently empty object)

Templates use Mustache syntax for includes:
```html
{{> partials/header.html}}
{{> partials/gallery_oil.html}}
```

When the `html` Gulp task runs, it:
1. Reads `data.json` for template data
2. Compiles all `.html` and `.mustache` files from `src/templates/`
3. Resolves partial includes
4. Outputs to `app/` directory

### Gallery Structure

Three separate galleries by medium:
- **Oil Paintings**: `src/templates/partials/gallery_oil.html`
- **Pastel Drawings**: `src/templates/partials/gallery_pastel.html`
- **Aquarelle**: `src/templates/partials/gallery_aquarell.html`

Individual artwork templates are in `src/templates/partials/gallery/[medium]/`:
- Main item templates: `picture[N].html`
- Detail/popup templates: `picture[N]_details.html`

### Image Naming Convention

Images follow a consistent pattern in `src/img/gallery/`:
```
picture[N]_1.jpg          # Main artwork image
picture[N]_1_preview.jpg  # Thumbnail/preview
picture[N]_2.jpg          # Additional views/details
picture[N]_3.jpg          # More detail shots
```

Where `[N]` is a sequential number for each artwork.

### Tilda Framework Components

The site uses pre-built Tilda components (CSS/JS classes):
- `t754` - Gallery/catalog with popup functionality
- `t102` - Hero/cover section with background images
- `t484` - Text content sections
- `t490` - Image display components
- `t578` - Contact section layout
- `t029` - Decorative line separators

These components have specific HTML structures and class names. When modifying templates, maintain the Tilda component structure to preserve functionality.

## Code Conventions

### ESLint Rules
The project uses these specific rules (see `.eslintrc.js`):
- 4-space indentation (enforced as error)
- Semicolons recommended (warning)
- `console.log` allowed (`no-console: 0`)
- CamelCase recommended (warning)
- Unused variables/escapes are warnings, not errors

### Babel Configuration
JavaScript is transpiled with `@babel/preset-env` to support older browsers. All JS in `src/js/` is processed through Babel before output to `app/js/`.

### File Watching
The `watch` task monitors changes with these settings:
- Polling interval: 1000ms
- Uses polling mode (important for Docker/VM environments)
- Triggers live reload on changes

## Docker Environment

The Docker setup uses Node.js 22 and mounts the project directory with a separate volume for `node_modules`. Ports:
- **7000** - Web server
- **35729** - LiveReload

The container automatically runs `npm install` and starts the server when launched with `docker-compose up`.

## Static Site Deployment

Production files are in `/app` directory after running `npm run build`. The site is fully static with no server-side requirements:
- Can be deployed to GitHub Pages, Netlify, Vercel, S3, etc.
- `gh-pages` package is included for GitHub Pages deployment
- Sitemap generator is configured for domain: `http://www.polins-shvedko.artist`

## Important Notes

- **Never edit files in `app/` directly** - they will be overwritten by the build process
- **Image optimization is separate** - run `npm run image` when adding new images
- **LiveReload port 35729** must be accessible for auto-refresh to work
- **Mustache templates** are logic-less - complex logic should be in `data.json`
- **Template data** is currently empty (`data.json` = `{}`), so no dynamic data is being injected
- The project name in `package.json` is "recipes" (legacy), but this is an artist portfolio site
