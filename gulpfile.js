var gulp = require('gulp');
var yargs = require('yargs');
var plugins = require('gulp-load-plugins')();
var browserify = require('browserify');
var babelify = require('babelify');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var request = require('request');

var args = yargs.argv;

// The open data hub disabled CORS so we need to cache the dataset here
var sourceData = 'https://opendata.arcgis.com/datasets/f62cbfbf11494495984097ef8ed6a8a9_0.geojson';
gulp.task('fetch', () => {
	return request(sourceData)
		.pipe(source('data.json'))
		.pipe(gulp.dest('./build'));
});


gulp.task('js', () => {
	return browserify({entries: 'src/js/start.js', debug: !args.prod})
		.transform('babelify', {presets: ['env']})
		.bundle()
		.pipe(source('start.js'))
		.pipe(buffer())
		.pipe(gulp.dest('./build/'));
});

gulp.task('serviceworker', () => {
	return browserify({entries: 'src/js/serviceworker.js', debug: !args.prod})
		.transform('babelify', {presets: ['env']})
		.bundle()
		.pipe(source('sw.js'))
		.pipe(buffer())
		.pipe(gulp.dest('./build/'));
});

gulp.task('sass', () => {
	return gulp.src('src/styles/style.scss')
		.pipe(plugins.sass())
		.pipe(plugins.combineMq())
//		.pipe(plugins.csso())
		.pipe(plugins.autoprefixer())
		.pipe(gulp.dest('./build/'));
});

gulp.task('views', () => {
	return gulp.src('src/views/**/*')
		.pipe(gulp.dest('./build/'));
});

gulp.task('images', () => {
	return gulp.src('src/images/*')
		.pipe(gulp.dest('./build/images/'));
});

gulp.task('watch', (done) => {
	gulp.watch('src/styles/*', ['sass']);
	gulp.watch('src/views/*', ['views']);
	gulp.watch('src/js/*', ['js']);
	gulp.watch('src/images/*', ['images']);
	done();
});

gulp.task('default', gulp.parallel('fetch', 'views', 'sass', 'js', 'serviceworker', 'images'));
