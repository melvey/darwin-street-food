var gulp = require('gulp');
var yargs = require('yargs');
var plugins = require('gulp-load-plugins')();
var browserify = require('browserify');
var babelify = require('babelify');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');

var args = yargs.argv;

gulp.task('js', () => {
	return browserify({entries: 'src/js/start.js', debug: !args.prod})
		.transform('babelify', {presets: ['env']})
		.bundle()
		.pipe(source('start.js'))
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

gulp.task('default', gulp.parallel('views', 'sass', 'js', 'images'));
