let gulp = require('gulp'),
    rename = require('gulp-rename'),
    autoprefixer = require('gulp-autoprefixer'),
    concat = require('gulp-concat'),
    uglify = require('gulp-uglify'),
    purge = require('gulp-css-purge'),
    server = require('gulp-webserver'),
    //liveReload extension for browser
    livereload = require('gulp-livereload'),
    cleanCSS = require('gulp-clean-css'),
    mustache = require("gulp-mustache"),
    htmlValidator = require('gulp-w3c-html-validator'),
    imagemin = require('gulp-imagemin'),
    sitemap = require('gulp-sitemap'),
    save = require('gulp-save');
    babel = require('gulp-babel');

//server start
gulp.task('server', () => {
    gulp.src('app')
        .pipe(server({
            open: true,
            port: 7000,
            host: '0.0.0.0'
        }));
});

//images processing
gulp.task('img', () => {
    return gulp.src('src/img/**/*.*')
        .pipe(imagemin({
            interlaced: true,
            progressive: true,
            optimizationLevel: 5,
            svgoPlugins: [
                {
                    removeViewBox: true
                }
            ]
        }))
        .pipe(gulp.dest('app/img'));
});

gulp.task('validateHtml', () => {
    return gulp.src('app/*.html')
        .pipe(htmlValidator())
        .pipe(htmlValidator.reporter());
});

//css generation
gulp.task('css', () => {
    return gulp.src('src/css/**/*.css')
        .pipe(gulp.dest('app/css'))
        .pipe(livereload());
});

gulp.task('babel', () =>
    gulp.src(
        [
            'src/js/**/*.js'
        ])
        .pipe(gulp.dest('app/js'))
        .pipe(livereload())
);

//html generation from mustache
gulp.task('html', () => {
    return gulp.src(["src/templates/**/*.html", "src/templates/**/*.mustache"])
        .pipe(mustache('data.json', {}, {}))
        .pipe(gulp.dest("app"))
        .pipe(livereload());
});

//generates sitemap
gulp.task('sitemap', () => {
    gulp.src('app/*.html', {
        read: false
    })
        .pipe(sitemap({
            siteUrl: 'http://www.polins-shvedko.artist'
        }))
        .pipe(gulp.dest('./app'));
});

//copy fonts
gulp.task('fonts', () => {
    return gulp.src('src/css/webfonts/**/*.*')
        .pipe(gulp.dest('app/css/webfonts'));
});

//watch task
gulp.task('watch', gulp.series(gulp.parallel('css', 'babel', 'html'), (done) => {
    gulp.watch('src/css/*.css', {interval: 1000, usePolling: true}, gulp.parallel('css'));
    gulp.watch('src/js/*.js', {interval: 1000, usePolling: true}, gulp.parallel('babel'));
    gulp.watch('src/templates/**/*.*', {interval: 1000, usePolling: true}, gulp.parallel('html'));
    done();
}));

//validation of html
gulp.task('validate-html', gulp.series('validateHtml'));

//validation of html
gulp.task('build', gulp.series('css', 'babel', 'html', 'img', 'fonts'));

//default task which is running simply from command line with gulp
gulp.task('default', gulp.series('watch', 'server'));
