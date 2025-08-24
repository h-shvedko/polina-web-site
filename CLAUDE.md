# Polina Shvedko Artist Website

## 🎨 What This Project Is About (Non-Technical Overview)

This is a professional portfolio website for **Polina Shvedko**, a German artist who specializes in three artistic mediums:
- **Oil paintings** - Rich, textured works with vibrant colors
- **Pastel drawings** - Soft, delicate pieces with subtle color palettes  
- **Aquarelle (Watercolor)** - Fluid, translucent artworks with natural flow

The website serves as:
- **Digital Art Gallery** - Showcasing artwork organized by medium (oil, pastel, aquarelle)
- **Artist Portfolio** - Professional presentation of artistic works with detailed descriptions
- **Contact Platform** - Ways for potential clients, collectors, and admirers to connect
- **Business Presence** - Professional online identity for art sales and commissions

### Key Features for Visitors:
- Browse artwork by artistic medium (oil, pastel, watercolor)
- View detailed images of each artwork with zoom functionality
- Read descriptions, dimensions, and pricing information
- Contact the artist directly via email or social media
- Mobile-friendly viewing experience

## 🛠️ Technical Documentation

### Project Architecture

**Technology Stack:**
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Templating**: Mustache.js templates
- **Build System**: Gulp.js with multiple automated tasks
- **Development Server**: Gulp WebServer with live reload
- **Containerization**: Docker & Docker Compose
- **Styling**: Tilda framework components + custom CSS

### Project Structure

```
polina-web-site/
├── src/                          # Source files (development)
│   ├── templates/                # Mustache template files
│   │   ├── index.html           # Main page template
│   │   └── partials/            # Reusable template components
│   │       ├── header.html      # Site header with hero image
│   │       ├── about.html       # Artist introduction
│   │       ├── gallery_oil.html    # Oil paintings gallery
│   │       ├── gallery_pastel.html # Pastel drawings gallery
│   │       ├── gallery_aquarell.html # Watercolor gallery
│   │       ├── contact.html     # Contact information
│   │       └── gallery/         # Individual artwork templates
│   ├── css/                     # Stylesheets
│   ├── js/                      # JavaScript files
│   └── img/                     # Source images
├── app/                         # Built files (production-ready)
│   ├── index.html              # Generated main page
│   ├── partials/               # Generated partial templates
│   ├── css/                    # Processed stylesheets
│   ├── js/                     # Processed JavaScript
│   └── img/                    # Optimized images
├── gulpfile.js                 # Build configuration
├── package.json                # Dependencies & scripts
├── docker-compose.yaml         # Container orchestration
└── data.json                   # Template data (currently empty)
```

### Build System (Gulp.js)

**Available NPM Scripts:**
```json
{
  "server-start": "gulp",           // Start development server
  "server-watch": "gulp watch",     // Watch files + live reload
  "validate-html": "gulp validate-html", // HTML validation
  "image": "gulp img",              // Image optimization
  "sitemap": "gulp sitemap",        // Generate XML sitemap
  "build": "gulp build"             // Full production build
}
```

**Gulp Tasks Breakdown:**

| Task | Purpose | Input | Output |
|------|---------|--------|--------|
| `css` | Copy & process CSS | `src/css/**/*.css` | `app/css/` |
| `babel` | JavaScript processing | `src/js/**/*.js` | `app/js/` |
| `html` | Template compilation | `src/templates/**/*.html` | `app/` |
| `img` | Image optimization | `src/img/**/*.*` | `app/img/` |
| `fonts` | Font copying | `src/css/webfonts/**/*.*` | `app/css/webfonts/` |
| `server` | Development server | - | http://localhost:7000 |
| `watch` | File watching + live reload | All source files | Real-time updates |

### Template System

**Mustache.js Integration:**
- Templates use `{{> partials/filename.html}}` syntax for includes
- Main layout: `src/templates/index.html`
- Data source: `data.json` (currently empty, but ready for dynamic content)
- Compiled output: `app/index.html`

**Gallery System Architecture:**
1. **Gallery Pages**: Three main gallery templates (`gallery_oil.html`, `gallery_pastel.html`, `gallery_aquarell.html`)
2. **Artwork Items**: Individual HTML templates for each piece in `src/templates/partials/gallery/[medium]/`
3. **Detail Views**: `*_details.html` files contain popup/modal content with:
   - High-resolution image galleries
   - Artwork titles and descriptions  
   - Dimensions and medium information
   - Pricing (in Euros)
   - Zoom functionality

### Styling Framework

**Tilda Components Used:**
- `t754` - Gallery/catalog component with popup functionality  
- `t102` - Hero/cover section with background image
- `t484` - Text sections for descriptions
- `t490` - Image display components
- `t578` - Contact section layout
- `t029` - Decorative line separators

**Responsive Design:**
- Mobile-first approach with progressive enhancement
- Breakpoint-based media queries
- Touch-friendly gallery navigation
- Optimized image loading for different screen sizes

### Development Workflow

**Local Development:**
```bash
# Using Docker (Recommended)
docker-compose up -d
docker ps  # Get container ID
docker exec -it [CONTAINER_ID] bash
npm run server-watch

# Or Direct Installation
npm install
npm run server-start  # Development server at http://localhost:7000
npm run server-watch  # With file watching
```

**Production Build:**
```bash
npm run build  # Generates optimized files in /app directory
```

### Image Management

**Image Organization:**
- **Source**: `src/img/gallery/` - Original high-resolution images
- **Generated**: `app/img/gallery/` - Optimized versions
- **Naming Convention**: 
  - `picture[N]_1.jpg` - Main artwork image
  - `picture[N]_1_preview.jpg` - Thumbnail/preview version
  - `picture[N]_2.jpg`, `picture[N]_3.jpg` - Additional views/details

**Optimization Settings:**
```javascript
imagemin({
    interlaced: true,        // Progressive JPEG
    progressive: true,       // Progressive rendering
    optimizationLevel: 5,    // High compression
    svgoPlugins: [{removeViewBox: true}]
})
```

### Security & Performance

**Security Measures:**
- No user input handling (static site)
- External links use `rel="nofollow"`
- Contact forms use mailto links (no server-side processing)

**Performance Optimizations:**
- Image optimization and compression
- CSS/JS minification ready (Tilda components pre-minified)
- Lazy loading for gallery images
- Static site generation for fast loading

### SEO & Accessibility

**SEO Features:**
- Automated sitemap generation (`gulp sitemap`)
- Structured data markup (Schema.org ImageObject)
- Semantic HTML structure
- Meta tags for social sharing

**Accessibility:**
- ARIA labels for interactive elements
- Proper heading hierarchy
- Alt text for images (schema markup)
- Keyboard navigation support
- Screen reader compatible

### Browser Compatibility

**Supported Browsers:**
- Chrome/Edge (latest)
- Firefox (latest)  
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

**Dependencies:**
```json
{
  "bootstrap": "^4.4.1",      // UI Framework
  "gh-pages": "^2.1.1",       // GitHub Pages deployment
  "idb": "^5.0.2"             // IndexedDB wrapper (unused currently)
}
```

### Deployment Options

**Static Hosting Compatible:**
- GitHub Pages (via `gh-pages` dependency)
- Netlify
- Vercel  
- AWS S3 + CloudFront
- Any static web server

**File Output:**
- All production files in `/app` directory
- No server-side requirements
- Pure HTML/CSS/JS delivery

### Future Enhancement Possibilities

**Technical Improvements:**
- Add CMS integration for easier content management
- Implement search functionality across artworks
- Add shopping cart for direct purchases
- Integrate with payment processing
- Add multi-language support
- Implement progressive web app (PWA) features

**Content Enhancements:**
- Artist blog/news section
- Exhibition history page
- Commission request forms
- Virtual gallery tours
- Video content integration

---

*This documentation covers the current state of the Polina Shvedko Artist Website as of the analysis date. The project is well-structured for a professional artist portfolio with room for future enhancements.*