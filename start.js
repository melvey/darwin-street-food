(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
*/

'use strict';

/**
 * @file Embedded JavaScript templating engine. {@link http://ejs.co}
 * @author Matthew Eernisse <mde@fleegix.org>
 * @author Tiancheng "Timothy" Gu <timothygu99@gmail.com>
 * @project EJS
 * @license {@link http://www.apache.org/licenses/LICENSE-2.0 Apache License, Version 2.0}
 */

/**
 * EJS internal functions.
 *
 * Technically this "module" lies in the same file as {@link module:ejs}, for
 * the sake of organization all the private functions re grouped into this
 * module.
 *
 * @module ejs-internal
 * @private
 */

/**
 * Embedded JavaScript templating engine.
 *
 * @module ejs
 * @public
 */

var fs = require('fs');
var path = require('path');
var utils = require('./utils');

var scopeOptionWarned = false;
var _VERSION_STRING = require('../package.json').version;
var _DEFAULT_DELIMITER = '%';
var _DEFAULT_LOCALS_NAME = 'locals';
var _NAME = 'ejs';
var _REGEX_STRING = '(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)';
var _OPTS_PASSABLE_WITH_DATA = ['delimiter', 'scope', 'context', 'debug', 'compileDebug',
  'client', '_with', 'rmWhitespace', 'strict', 'filename', 'async'];
// We don't allow 'cache' option to be passed in the data obj for
// the normal `render` call, but this is where Express 2 & 3 put it
// so we make an exception for `renderFile`
var _OPTS_PASSABLE_WITH_DATA_EXPRESS = _OPTS_PASSABLE_WITH_DATA.concat('cache');
var _BOM = /^\uFEFF/;

/**
 * EJS template function cache. This can be a LRU object from lru-cache NPM
 * module. By default, it is {@link module:utils.cache}, a simple in-process
 * cache that grows continuously.
 *
 * @type {Cache}
 */

exports.cache = utils.cache;

/**
 * Custom file loader. Useful for template preprocessing or restricting access
 * to a certain part of the filesystem.
 *
 * @type {fileLoader}
 */

exports.fileLoader = fs.readFileSync;

/**
 * Name of the object containing the locals.
 *
 * This variable is overridden by {@link Options}`.localsName` if it is not
 * `undefined`.
 *
 * @type {String}
 * @public
 */

exports.localsName = _DEFAULT_LOCALS_NAME;

/**
 * Promise implementation -- defaults to the native implementation if available
 * This is mostly just for testability
 *
 * @type {Function}
 * @public
 */

exports.promiseImpl = (new Function('return this;'))().Promise;

/**
 * Get the path to the included file from the parent file path and the
 * specified path.
 *
 * @param {String}  name     specified path
 * @param {String}  filename parent file path
 * @param {Boolean} isDir    parent file path whether is directory
 * @return {String}
 */
exports.resolveInclude = function(name, filename, isDir) {
  var dirname = path.dirname;
  var extname = path.extname;
  var resolve = path.resolve;
  var includePath = resolve(isDir ? filename : dirname(filename), name);
  var ext = extname(name);
  if (!ext) {
    includePath += '.ejs';
  }
  return includePath;
};

/**
 * Get the path to the included file by Options
 *
 * @param  {String}  path    specified path
 * @param  {Options} options compilation options
 * @return {String}
 */
function getIncludePath(path, options) {
  var includePath;
  var filePath;
  var views = options.views;

  // Abs path
  if (path.charAt(0) == '/') {
    includePath = exports.resolveInclude(path.replace(/^\/*/,''), options.root || '/', true);
  }
  // Relative paths
  else {
    // Look relative to a passed filename first
    if (options.filename) {
      filePath = exports.resolveInclude(path, options.filename);
      if (fs.existsSync(filePath)) {
        includePath = filePath;
      }
    }
    // Then look in any views directories
    if (!includePath) {
      if (Array.isArray(views) && views.some(function (v) {
        filePath = exports.resolveInclude(path, v, true);
        return fs.existsSync(filePath);
      })) {
        includePath = filePath;
      }
    }
    if (!includePath) {
      throw new Error('Could not find the include file "' +
          options.escapeFunction(path) + '"');
    }
  }
  return includePath;
}

/**
 * Get the template from a string or a file, either compiled on-the-fly or
 * read from cache (if enabled), and cache the template if needed.
 *
 * If `template` is not set, the file specified in `options.filename` will be
 * read.
 *
 * If `options.cache` is true, this function reads the file from
 * `options.filename` so it must be set prior to calling this function.
 *
 * @memberof module:ejs-internal
 * @param {Options} options   compilation options
 * @param {String} [template] template source
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned.
 * @static
 */

function handleCache(options, template) {
  var func;
  var filename = options.filename;
  var hasTemplate = arguments.length > 1;

  if (options.cache) {
    if (!filename) {
      throw new Error('cache option requires a filename');
    }
    func = exports.cache.get(filename);
    if (func) {
      return func;
    }
    if (!hasTemplate) {
      template = fileLoader(filename).toString().replace(_BOM, '');
    }
  }
  else if (!hasTemplate) {
    // istanbul ignore if: should not happen at all
    if (!filename) {
      throw new Error('Internal EJS error: no file name or template '
                    + 'provided');
    }
    template = fileLoader(filename).toString().replace(_BOM, '');
  }
  func = exports.compile(template, options);
  if (options.cache) {
    exports.cache.set(filename, func);
  }
  return func;
}

/**
 * Try calling handleCache with the given options and data and call the
 * callback with the result. If an error occurs, call the callback with
 * the error. Used by renderFile().
 *
 * @memberof module:ejs-internal
 * @param {Options} options    compilation options
 * @param {Object} data        template data
 * @param {RenderFileCallback} cb callback
 * @static
 */

function tryHandleCache(options, data, cb) {
  var result;
  if (!cb) {
    if (typeof exports.promiseImpl == 'function') {
      return new exports.promiseImpl(function (resolve, reject) {
        try {
          result = handleCache(options)(data);
          resolve(result);
        }
        catch (err) {
          reject(err);
        }
      });
    }
    else {
      throw new Error('Please provide a callback function');
    }
  }
  else {
    try {
      result = handleCache(options)(data);
    }
    catch (err) {
      return cb(err);
    }

    cb(null, result);
  }
}

/**
 * fileLoader is independent
 *
 * @param {String} filePath ejs file path.
 * @return {String} The contents of the specified file.
 * @static
 */

function fileLoader(filePath){
  return exports.fileLoader(filePath);
}

/**
 * Get the template function.
 *
 * If `options.cache` is `true`, then the template is cached.
 *
 * @memberof module:ejs-internal
 * @param {String}  path    path for the specified file
 * @param {Options} options compilation options
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned
 * @static
 */

function includeFile(path, options) {
  var opts = utils.shallowCopy({}, options);
  opts.filename = getIncludePath(path, opts);
  return handleCache(opts);
}

/**
 * Get the JavaScript source of an included file.
 *
 * @memberof module:ejs-internal
 * @param {String}  path    path for the specified file
 * @param {Options} options compilation options
 * @return {Object}
 * @static
 */

function includeSource(path, options) {
  var opts = utils.shallowCopy({}, options);
  var includePath;
  var template;
  includePath = getIncludePath(path, opts);
  template = fileLoader(includePath).toString().replace(_BOM, '');
  opts.filename = includePath;
  var templ = new Template(template, opts);
  templ.generateSource();
  return {
    source: templ.source,
    filename: includePath,
    template: template
  };
}

/**
 * Re-throw the given `err` in context to the `str` of ejs, `filename`, and
 * `lineno`.
 *
 * @implements RethrowCallback
 * @memberof module:ejs-internal
 * @param {Error}  err      Error object
 * @param {String} str      EJS source
 * @param {String} filename file name of the EJS file
 * @param {String} lineno   line number of the error
 * @static
 */

function rethrow(err, str, flnm, lineno, esc){
  var lines = str.split('\n');
  var start = Math.max(lineno - 3, 0);
  var end = Math.min(lines.length, lineno + 3);
  var filename = esc(flnm); // eslint-disable-line
  // Error context
  var context = lines.slice(start, end).map(function (line, i){
    var curr = i + start + 1;
    return (curr == lineno ? ' >> ' : '    ')
      + curr
      + '| '
      + line;
  }).join('\n');

  // Alter exception message
  err.path = filename;
  err.message = (filename || 'ejs') + ':'
    + lineno + '\n'
    + context + '\n\n'
    + err.message;

  throw err;
}

function stripSemi(str){
  return str.replace(/;(\s*$)/, '$1');
}

/**
 * Compile the given `str` of ejs into a template function.
 *
 * @param {String}  template EJS template
 *
 * @param {Options} opts     compilation options
 *
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `opts.client`, either type might be returned.
 * Note that the return type of the function also depends on the value of `opts.async`.
 * @public
 */

exports.compile = function compile(template, opts) {
  var templ;

  // v1 compat
  // 'scope' is 'context'
  // FIXME: Remove this in a future version
  if (opts && opts.scope) {
    if (!scopeOptionWarned){
      console.warn('`scope` option is deprecated and will be removed in EJS 3');
      scopeOptionWarned = true;
    }
    if (!opts.context) {
      opts.context = opts.scope;
    }
    delete opts.scope;
  }
  templ = new Template(template, opts);
  return templ.compile();
};

/**
 * Render the given `template` of ejs.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}   template EJS template
 * @param {Object}  [data={}] template data
 * @param {Options} [opts={}] compilation and rendering options
 * @return {(String|Promise<String>)}
 * Return value type depends on `opts.async`.
 * @public
 */

exports.render = function (template, d, o) {
  var data = d || {};
  var opts = o || {};

  // No options object -- if there are optiony names
  // in the data, copy them to options
  if (arguments.length == 2) {
    utils.shallowCopyFromList(opts, data, _OPTS_PASSABLE_WITH_DATA);
  }

  return handleCache(opts, template)(data);
};

/**
 * Render an EJS file at the given `path` and callback `cb(err, str)`.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}             path     path to the EJS file
 * @param {Object}            [data={}] template data
 * @param {Options}           [opts={}] compilation and rendering options
 * @param {RenderFileCallback} cb callback
 * @public
 */

exports.renderFile = function () {
  var args = Array.prototype.slice.call(arguments);
  var filename = args.shift();
  var cb;
  var opts = {filename: filename};
  var data;
  var viewOpts;

  // Do we have a callback?
  if (typeof arguments[arguments.length - 1] == 'function') {
    cb = args.pop();
  }
  // Do we have data/opts?
  if (args.length) {
    // Should always have data obj
    data = args.shift();
    // Normal passed opts (data obj + opts obj)
    if (args.length) {
      // Use shallowCopy so we don't pollute passed in opts obj with new vals
      utils.shallowCopy(opts, args.pop());
    }
    // Special casing for Express (settings + opts-in-data)
    else {
      // Express 3 and 4
      if (data.settings) {
        // Pull a few things from known locations
        if (data.settings.views) {
          opts.views = data.settings.views;
        }
        if (data.settings['view cache']) {
          opts.cache = true;
        }
        // Undocumented after Express 2, but still usable, esp. for
        // items that are unsafe to be passed along with data, like `root`
        viewOpts = data.settings['view options'];
        if (viewOpts) {
          utils.shallowCopy(opts, viewOpts);
        }
      }
      // Express 2 and lower, values set in app.locals, or people who just
      // want to pass options in their data. NOTE: These values will override
      // anything previously set in settings  or settings['view options']
      utils.shallowCopyFromList(opts, data, _OPTS_PASSABLE_WITH_DATA_EXPRESS);
    }
    opts.filename = filename;
  }
  else {
    data = {};
  }

  return tryHandleCache(opts, data, cb);
};

/**
 * Clear intermediate JavaScript cache. Calls {@link Cache#reset}.
 * @public
 */

exports.clearCache = function () {
  exports.cache.reset();
};

function Template(text, opts) {
  opts = opts || {};
  var options = {};
  this.templateText = text;
  this.mode = null;
  this.truncate = false;
  this.currentLine = 1;
  this.source = '';
  this.dependencies = [];
  options.client = opts.client || false;
  options.escapeFunction = opts.escape || utils.escapeXML;
  options.compileDebug = opts.compileDebug !== false;
  options.debug = !!opts.debug;
  options.filename = opts.filename;
  options.delimiter = opts.delimiter || exports.delimiter || _DEFAULT_DELIMITER;
  options.strict = opts.strict || false;
  options.context = opts.context;
  options.cache = opts.cache || false;
  options.rmWhitespace = opts.rmWhitespace;
  options.root = opts.root;
  options.outputFunctionName = opts.outputFunctionName;
  options.localsName = opts.localsName || exports.localsName || _DEFAULT_LOCALS_NAME;
  options.views = opts.views;
  options.async = opts.async;

  if (options.strict) {
    options._with = false;
  }
  else {
    options._with = typeof opts._with != 'undefined' ? opts._with : true;
  }

  this.opts = options;

  this.regex = this.createRegex();
}

Template.modes = {
  EVAL: 'eval',
  ESCAPED: 'escaped',
  RAW: 'raw',
  COMMENT: 'comment',
  LITERAL: 'literal'
};

Template.prototype = {
  createRegex: function () {
    var str = _REGEX_STRING;
    var delim = utils.escapeRegExpChars(this.opts.delimiter);
    str = str.replace(/%/g, delim);
    return new RegExp(str);
  },

  compile: function () {
    var src;
    var fn;
    var opts = this.opts;
    var prepended = '';
    var appended = '';
    var escapeFn = opts.escapeFunction;
    var asyncCtor;

    if (!this.source) {
      this.generateSource();
      prepended += '  var __output = [], __append = __output.push.bind(__output);' + '\n';
      if (opts.outputFunctionName) {
        prepended += '  var ' + opts.outputFunctionName + ' = __append;' + '\n';
      }
      if (opts._with !== false) {
        prepended +=  '  with (' + opts.localsName + ' || {}) {' + '\n';
        appended += '  }' + '\n';
      }
      appended += '  return __output.join("");' + '\n';
      this.source = prepended + this.source + appended;
    }

    if (opts.compileDebug) {
      src = 'var __line = 1' + '\n'
        + '  , __lines = ' + JSON.stringify(this.templateText) + '\n'
        + '  , __filename = ' + (opts.filename ?
        JSON.stringify(opts.filename) : 'undefined') + ';' + '\n'
        + 'try {' + '\n'
        + this.source
        + '} catch (e) {' + '\n'
        + '  rethrow(e, __lines, __filename, __line, escapeFn);' + '\n'
        + '}' + '\n';
    }
    else {
      src = this.source;
    }

    if (opts.client) {
      src = 'escapeFn = escapeFn || ' + escapeFn.toString() + ';' + '\n' + src;
      if (opts.compileDebug) {
        src = 'rethrow = rethrow || ' + rethrow.toString() + ';' + '\n' + src;
      }
    }

    if (opts.strict) {
      src = '"use strict";\n' + src;
    }
    if (opts.debug) {
      console.log(src);
    }

    try {
      if (opts.async) {
        // Have to use generated function for this, since in envs without support,
        // it breaks in parsing
        try {
          asyncCtor = (new Function('return (async function(){}).constructor;'))();
        }
        catch(e) {
          if (e instanceof SyntaxError) {
            throw new Error('This environment does not support async/await');
          }
          else {
            throw e;
          }
        }
      }
      else {
        asyncCtor = Function;
      }
      fn = new asyncCtor(opts.localsName + ', escapeFn, include, rethrow', src);
    }
    catch(e) {
      // istanbul ignore else
      if (e instanceof SyntaxError) {
        if (opts.filename) {
          e.message += ' in ' + opts.filename;
        }
        e.message += ' while compiling ejs\n\n';
        e.message += 'If the above error is not helpful, you may want to try EJS-Lint:\n';
        e.message += 'https://github.com/RyanZim/EJS-Lint';
        if (!e.async) {
          e.message += '\n';
          e.message += 'Or, if you meant to create an async function, pass async: true as an option.';
        }
      }
      throw e;
    }

    if (opts.client) {
      fn.dependencies = this.dependencies;
      return fn;
    }

    // Return a callable function which will execute the function
    // created by the source-code, with the passed data as locals
    // Adds a local `include` function which allows full recursive include
    var returnedFn = function (data) {
      var include = function (path, includeData) {
        var d = utils.shallowCopy({}, data);
        if (includeData) {
          d = utils.shallowCopy(d, includeData);
        }
        return includeFile(path, opts)(d);
      };
      return fn.apply(opts.context, [data || {}, escapeFn, include, rethrow]);
    };
    returnedFn.dependencies = this.dependencies;
    return returnedFn;
  },

  generateSource: function () {
    var opts = this.opts;

    if (opts.rmWhitespace) {
      // Have to use two separate replace here as `^` and `$` operators don't
      // work well with `\r`.
      this.templateText =
        this.templateText.replace(/\r/g, '').replace(/^\s+|\s+$/gm, '');
    }

    // Slurp spaces and tabs before <%_ and after _%>
    this.templateText =
      this.templateText.replace(/[ \t]*<%_/gm, '<%_').replace(/_%>[ \t]*/gm, '_%>');

    var self = this;
    var matches = this.parseTemplateText();
    var d = this.opts.delimiter;

    if (matches && matches.length) {
      matches.forEach(function (line, index) {
        var opening;
        var closing;
        var include;
        var includeOpts;
        var includeObj;
        var includeSrc;
        // If this is an opening tag, check for closing tags
        // FIXME: May end up with some false positives here
        // Better to store modes as k/v with '<' + delimiter as key
        // Then this can simply check against the map
        if ( line.indexOf('<' + d) === 0        // If it is a tag
          && line.indexOf('<' + d + d) !== 0) { // and is not escaped
          closing = matches[index + 2];
          if (!(closing == d + '>' || closing == '-' + d + '>' || closing == '_' + d + '>')) {
            throw new Error('Could not find matching close tag for "' + line + '".');
          }
        }
        // HACK: backward-compat `include` preprocessor directives
        if ((include = line.match(/^\s*include\s+(\S+)/))) {
          opening = matches[index - 1];
          // Must be in EVAL or RAW mode
          if (opening && (opening == '<' + d || opening == '<' + d + '-' || opening == '<' + d + '_')) {
            includeOpts = utils.shallowCopy({}, self.opts);
            includeObj = includeSource(include[1], includeOpts);
            if (self.opts.compileDebug) {
              includeSrc =
                  '    ; (function(){' + '\n'
                  + '      var __line = 1' + '\n'
                  + '      , __lines = ' + JSON.stringify(includeObj.template) + '\n'
                  + '      , __filename = ' + JSON.stringify(includeObj.filename) + ';' + '\n'
                  + '      try {' + '\n'
                  + includeObj.source
                  + '      } catch (e) {' + '\n'
                  + '        rethrow(e, __lines, __filename, __line, escapeFn);' + '\n'
                  + '      }' + '\n'
                  + '    ; }).call(this)' + '\n';
            }else{
              includeSrc = '    ; (function(){' + '\n' + includeObj.source +
                  '    ; }).call(this)' + '\n';
            }
            self.source += includeSrc;
            self.dependencies.push(exports.resolveInclude(include[1],
              includeOpts.filename));
            return;
          }
        }
        self.scanLine(line);
      });
    }

  },

  parseTemplateText: function () {
    var str = this.templateText;
    var pat = this.regex;
    var result = pat.exec(str);
    var arr = [];
    var firstPos;

    while (result) {
      firstPos = result.index;

      if (firstPos !== 0) {
        arr.push(str.substring(0, firstPos));
        str = str.slice(firstPos);
      }

      arr.push(result[0]);
      str = str.slice(result[0].length);
      result = pat.exec(str);
    }

    if (str) {
      arr.push(str);
    }

    return arr;
  },

  _addOutput: function (line) {
    if (this.truncate) {
      // Only replace single leading linebreak in the line after
      // -%> tag -- this is the single, trailing linebreak
      // after the tag that the truncation mode replaces
      // Handle Win / Unix / old Mac linebreaks -- do the \r\n
      // combo first in the regex-or
      line = line.replace(/^(?:\r\n|\r|\n)/, '');
      this.truncate = false;
    }
    else if (this.opts.rmWhitespace) {
      // rmWhitespace has already removed trailing spaces, just need
      // to remove linebreaks
      line = line.replace(/^\n/, '');
    }
    if (!line) {
      return line;
    }

    // Preserve literal slashes
    line = line.replace(/\\/g, '\\\\');

    // Convert linebreaks
    line = line.replace(/\n/g, '\\n');
    line = line.replace(/\r/g, '\\r');

    // Escape double-quotes
    // - this will be the delimiter during execution
    line = line.replace(/"/g, '\\"');
    this.source += '    ; __append("' + line + '")' + '\n';
  },

  scanLine: function (line) {
    var self = this;
    var d = this.opts.delimiter;
    var newLineCount = 0;

    newLineCount = (line.split('\n').length - 1);

    switch (line) {
    case '<' + d:
    case '<' + d + '_':
      this.mode = Template.modes.EVAL;
      break;
    case '<' + d + '=':
      this.mode = Template.modes.ESCAPED;
      break;
    case '<' + d + '-':
      this.mode = Template.modes.RAW;
      break;
    case '<' + d + '#':
      this.mode = Template.modes.COMMENT;
      break;
    case '<' + d + d:
      this.mode = Template.modes.LITERAL;
      this.source += '    ; __append("' + line.replace('<' + d + d, '<' + d) + '")' + '\n';
      break;
    case d + d + '>':
      this.mode = Template.modes.LITERAL;
      this.source += '    ; __append("' + line.replace(d + d + '>', d + '>') + '")' + '\n';
      break;
    case d + '>':
    case '-' + d + '>':
    case '_' + d + '>':
      if (this.mode == Template.modes.LITERAL) {
        this._addOutput(line);
      }

      this.mode = null;
      this.truncate = line.indexOf('-') === 0 || line.indexOf('_') === 0;
      break;
    default:
      // In script mode, depends on type of tag
      if (this.mode) {
        // If '//' is found without a line break, add a line break.
        switch (this.mode) {
        case Template.modes.EVAL:
        case Template.modes.ESCAPED:
        case Template.modes.RAW:
          if (line.lastIndexOf('//') > line.lastIndexOf('\n')) {
            line += '\n';
          }
        }
        switch (this.mode) {
        // Just executing code
        case Template.modes.EVAL:
          this.source += '    ; ' + line + '\n';
          break;
          // Exec, esc, and output
        case Template.modes.ESCAPED:
          this.source += '    ; __append(escapeFn(' + stripSemi(line) + '))' + '\n';
          break;
          // Exec and output
        case Template.modes.RAW:
          this.source += '    ; __append(' + stripSemi(line) + ')' + '\n';
          break;
        case Template.modes.COMMENT:
          // Do nothing
          break;
          // Literal <%% mode, append as raw output
        case Template.modes.LITERAL:
          this._addOutput(line);
          break;
        }
      }
      // In string mode, just add the output
      else {
        this._addOutput(line);
      }
    }

    if (self.opts.compileDebug && newLineCount) {
      this.currentLine += newLineCount;
      this.source += '    ; __line = ' + this.currentLine + '\n';
    }
  }
};

/**
 * Escape characters reserved in XML.
 *
 * This is simply an export of {@link module:utils.escapeXML}.
 *
 * If `markup` is `undefined` or `null`, the empty string is returned.
 *
 * @param {String} markup Input string
 * @return {String} Escaped string
 * @public
 * @func
 * */
exports.escapeXML = utils.escapeXML;

/**
 * Express.js support.
 *
 * This is an alias for {@link module:ejs.renderFile}, in order to support
 * Express.js out-of-the-box.
 *
 * @func
 */

exports.__express = exports.renderFile;

// Add require support
/* istanbul ignore else */
if (require.extensions) {
  require.extensions['.ejs'] = function (module, flnm) {
    var filename = flnm || /* istanbul ignore next */ module.filename;
    var options = {
      filename: filename,
      client: true
    };
    var template = fileLoader(filename).toString();
    var fn = exports.compile(template, options);
    module._compile('module.exports = ' + fn.toString() + ';', filename);
  };
}

/**
 * Version of EJS.
 *
 * @readonly
 * @type {String}
 * @public
 */

exports.VERSION = _VERSION_STRING;

/**
 * Name for detection of EJS.
 *
 * @readonly
 * @type {String}
 * @public
 */

exports.name = _NAME;

/* istanbul ignore if */
if (typeof window != 'undefined') {
  window.ejs = exports;
}

},{"../package.json":4,"./utils":3,"fs":1,"path":5}],3:[function(require,module,exports){
/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
*/

/**
 * Private utility functions
 * @module utils
 * @private
 */

'use strict';

var regExpChars = /[|\\{}()[\]^$+*?.]/g;

/**
 * Escape characters reserved in regular expressions.
 *
 * If `string` is `undefined` or `null`, the empty string is returned.
 *
 * @param {String} string Input string
 * @return {String} Escaped string
 * @static
 * @private
 */
exports.escapeRegExpChars = function (string) {
  // istanbul ignore if
  if (!string) {
    return '';
  }
  return String(string).replace(regExpChars, '\\$&');
};

var _ENCODE_HTML_RULES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;'
};
var _MATCH_HTML = /[&<>'"]/g;

function encode_char(c) {
  return _ENCODE_HTML_RULES[c] || c;
}

/**
 * Stringified version of constants used by {@link module:utils.escapeXML}.
 *
 * It is used in the process of generating {@link ClientFunction}s.
 *
 * @readonly
 * @type {String}
 */

var escapeFuncStr =
  'var _ENCODE_HTML_RULES = {\n'
+ '      "&": "&amp;"\n'
+ '    , "<": "&lt;"\n'
+ '    , ">": "&gt;"\n'
+ '    , \'"\': "&#34;"\n'
+ '    , "\'": "&#39;"\n'
+ '    }\n'
+ '  , _MATCH_HTML = /[&<>\'"]/g;\n'
+ 'function encode_char(c) {\n'
+ '  return _ENCODE_HTML_RULES[c] || c;\n'
+ '};\n';

/**
 * Escape characters reserved in XML.
 *
 * If `markup` is `undefined` or `null`, the empty string is returned.
 *
 * @implements {EscapeCallback}
 * @param {String} markup Input string
 * @return {String} Escaped string
 * @static
 * @private
 */

exports.escapeXML = function (markup) {
  return markup == undefined
    ? ''
    : String(markup)
      .replace(_MATCH_HTML, encode_char);
};
exports.escapeXML.toString = function () {
  return Function.prototype.toString.call(this) + ';\n' + escapeFuncStr;
};

/**
 * Naive copy of properties from one object to another.
 * Does not recurse into non-scalar properties
 * Does not check to see if the property has a value before copying
 *
 * @param  {Object} to   Destination object
 * @param  {Object} from Source object
 * @return {Object}      Destination object
 * @static
 * @private
 */
exports.shallowCopy = function (to, from) {
  from = from || {};
  for (var p in from) {
    to[p] = from[p];
  }
  return to;
};

/**
 * Naive copy of a list of key names, from one object to another.
 * Only copies property if it is actually defined
 * Does not recurse into non-scalar properties
 *
 * @param  {Object} to   Destination object
 * @param  {Object} from Source object
 * @param  {Array} list List of properties to copy
 * @return {Object}      Destination object
 * @static
 * @private
 */
exports.shallowCopyFromList = function (to, from, list) {
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (typeof from[p] != 'undefined') {
      to[p] = from[p];
    }
  }
  return to;
};

/**
 * Simple in-process cache implementation. Does not implement limits of any
 * sort.
 *
 * @implements Cache
 * @static
 * @private
 */
exports.cache = {
  _data: {},
  set: function (key, val) {
    this._data[key] = val;
  },
  get: function (key) {
    return this._data[key];
  },
  reset: function () {
    this._data = {};
  }
};

},{}],4:[function(require,module,exports){
module.exports={
  "_from": "ejs",
  "_id": "ejs@2.6.1",
  "_inBundle": false,
  "_integrity": "sha512-0xy4A/twfrRCnkhfk8ErDi5DqdAsAqeGxht4xkCUrsvhhbQNs7E+4jV0CN7+NKIY0aHE72+XvqtBIXzD31ZbXQ==",
  "_location": "/ejs",
  "_phantomChildren": {},
  "_requested": {
    "type": "tag",
    "registry": true,
    "raw": "ejs",
    "name": "ejs",
    "escapedName": "ejs",
    "rawSpec": "",
    "saveSpec": null,
    "fetchSpec": "latest"
  },
  "_requiredBy": [
    "#DEV:/",
    "#USER"
  ],
  "_resolved": "https://registry.npmjs.org/ejs/-/ejs-2.6.1.tgz",
  "_shasum": "498ec0d495655abc6f23cd61868d926464071aa0",
  "_spec": "ejs",
  "_where": "/var/www/html/hit238/foodvans",
  "author": {
    "name": "Matthew Eernisse",
    "email": "mde@fleegix.org",
    "url": "http://fleegix.org"
  },
  "bugs": {
    "url": "https://github.com/mde/ejs/issues"
  },
  "bundleDependencies": false,
  "contributors": [
    {
      "name": "Timothy Gu",
      "email": "timothygu99@gmail.com",
      "url": "https://timothygu.github.io"
    }
  ],
  "dependencies": {},
  "deprecated": false,
  "description": "Embedded JavaScript templates",
  "devDependencies": {
    "browserify": "^13.1.1",
    "eslint": "^4.14.0",
    "git-directory-deploy": "^1.5.1",
    "istanbul": "~0.4.3",
    "jake": "^8.0.16",
    "jsdoc": "^3.4.0",
    "lru-cache": "^4.0.1",
    "mocha": "^5.0.5",
    "uglify-js": "^3.3.16"
  },
  "engines": {
    "node": ">=0.10.0"
  },
  "homepage": "https://github.com/mde/ejs",
  "keywords": [
    "template",
    "engine",
    "ejs"
  ],
  "license": "Apache-2.0",
  "main": "./lib/ejs.js",
  "name": "ejs",
  "repository": {
    "type": "git",
    "url": "git://github.com/mde/ejs.git"
  },
  "scripts": {
    "coverage": "istanbul cover node_modules/mocha/bin/_mocha",
    "devdoc": "jake doc[dev]",
    "doc": "jake doc",
    "lint": "eslint \"**/*.js\" Jakefile",
    "test": "jake test"
  },
  "version": "2.6.1"
}

},{}],5:[function(require,module,exports){
(function (process){
// .dirname, .basename, and .extname methods are extracted from Node.js v8.11.1,
// backported and transplited with Babel, with backwards-compat fixes

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function (path) {
  if (typeof path !== 'string') path = path + '';
  if (path.length === 0) return '.';
  var code = path.charCodeAt(0);
  var hasRoot = code === 47 /*/*/;
  var end = -1;
  var matchedSlash = true;
  for (var i = path.length - 1; i >= 1; --i) {
    code = path.charCodeAt(i);
    if (code === 47 /*/*/) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
      // We saw the first non-path separator
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) {
    // return '//';
    // Backwards-compat fix:
    return '/';
  }
  return path.slice(0, end);
};

function basename(path) {
  if (typeof path !== 'string') path = path + '';

  var start = 0;
  var end = -1;
  var matchedSlash = true;
  var i;

  for (i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === 47 /*/*/) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // path component
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) return '';
  return path.slice(start, end);
}

// Uses a mixed approach for backwards-compatibility, as ext behavior changed
// in new Node.js versions, so only basename() above is backported here
exports.basename = function (path, ext) {
  var f = basename(path);
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};

exports.extname = function (path) {
  if (typeof path !== 'string') path = path + '';
  var startDot = -1;
  var startPart = 0;
  var end = -1;
  var matchedSlash = true;
  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  var preDotState = 0;
  for (var i = path.length - 1; i >= 0; --i) {
    var code = path.charCodeAt(i);
    if (code === 47 /*/*/) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46 /*.*/) {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1)
          startDot = i;
        else if (preDotState !== 1)
          preDotState = 1;
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (startDot === -1 || end === -1 ||
      // We saw a non-dot character immediately before the dot
      preDotState === 0 ||
      // The (right-most) trimmed path component is exactly '..'
      preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return '';
  }
  return path.slice(startDot, end);
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))

},{"_process":6}],6:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],7:[function(require,module,exports){
(function(self) {
  'use strict';

  if (self.fetch) {
    return
  }

  var support = {
    searchParams: 'URLSearchParams' in self,
    iterable: 'Symbol' in self && 'iterator' in Symbol,
    blob: 'FileReader' in self && 'Blob' in self && (function() {
      try {
        new Blob()
        return true
      } catch(e) {
        return false
      }
    })(),
    formData: 'FormData' in self,
    arrayBuffer: 'ArrayBuffer' in self
  }

  if (support.arrayBuffer) {
    var viewClasses = [
      '[object Int8Array]',
      '[object Uint8Array]',
      '[object Uint8ClampedArray]',
      '[object Int16Array]',
      '[object Uint16Array]',
      '[object Int32Array]',
      '[object Uint32Array]',
      '[object Float32Array]',
      '[object Float64Array]'
    ]

    var isDataView = function(obj) {
      return obj && DataView.prototype.isPrototypeOf(obj)
    }

    var isArrayBufferView = ArrayBuffer.isView || function(obj) {
      return obj && viewClasses.indexOf(Object.prototype.toString.call(obj)) > -1
    }
  }

  function normalizeName(name) {
    if (typeof name !== 'string') {
      name = String(name)
    }
    if (/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(name)) {
      throw new TypeError('Invalid character in header field name')
    }
    return name.toLowerCase()
  }

  function normalizeValue(value) {
    if (typeof value !== 'string') {
      value = String(value)
    }
    return value
  }

  // Build a destructive iterator for the value list
  function iteratorFor(items) {
    var iterator = {
      next: function() {
        var value = items.shift()
        return {done: value === undefined, value: value}
      }
    }

    if (support.iterable) {
      iterator[Symbol.iterator] = function() {
        return iterator
      }
    }

    return iterator
  }

  function Headers(headers) {
    this.map = {}

    if (headers instanceof Headers) {
      headers.forEach(function(value, name) {
        this.append(name, value)
      }, this)
    } else if (Array.isArray(headers)) {
      headers.forEach(function(header) {
        this.append(header[0], header[1])
      }, this)
    } else if (headers) {
      Object.getOwnPropertyNames(headers).forEach(function(name) {
        this.append(name, headers[name])
      }, this)
    }
  }

  Headers.prototype.append = function(name, value) {
    name = normalizeName(name)
    value = normalizeValue(value)
    var oldValue = this.map[name]
    this.map[name] = oldValue ? oldValue+','+value : value
  }

  Headers.prototype['delete'] = function(name) {
    delete this.map[normalizeName(name)]
  }

  Headers.prototype.get = function(name) {
    name = normalizeName(name)
    return this.has(name) ? this.map[name] : null
  }

  Headers.prototype.has = function(name) {
    return this.map.hasOwnProperty(normalizeName(name))
  }

  Headers.prototype.set = function(name, value) {
    this.map[normalizeName(name)] = normalizeValue(value)
  }

  Headers.prototype.forEach = function(callback, thisArg) {
    for (var name in this.map) {
      if (this.map.hasOwnProperty(name)) {
        callback.call(thisArg, this.map[name], name, this)
      }
    }
  }

  Headers.prototype.keys = function() {
    var items = []
    this.forEach(function(value, name) { items.push(name) })
    return iteratorFor(items)
  }

  Headers.prototype.values = function() {
    var items = []
    this.forEach(function(value) { items.push(value) })
    return iteratorFor(items)
  }

  Headers.prototype.entries = function() {
    var items = []
    this.forEach(function(value, name) { items.push([name, value]) })
    return iteratorFor(items)
  }

  if (support.iterable) {
    Headers.prototype[Symbol.iterator] = Headers.prototype.entries
  }

  function consumed(body) {
    if (body.bodyUsed) {
      return Promise.reject(new TypeError('Already read'))
    }
    body.bodyUsed = true
  }

  function fileReaderReady(reader) {
    return new Promise(function(resolve, reject) {
      reader.onload = function() {
        resolve(reader.result)
      }
      reader.onerror = function() {
        reject(reader.error)
      }
    })
  }

  function readBlobAsArrayBuffer(blob) {
    var reader = new FileReader()
    var promise = fileReaderReady(reader)
    reader.readAsArrayBuffer(blob)
    return promise
  }

  function readBlobAsText(blob) {
    var reader = new FileReader()
    var promise = fileReaderReady(reader)
    reader.readAsText(blob)
    return promise
  }

  function readArrayBufferAsText(buf) {
    var view = new Uint8Array(buf)
    var chars = new Array(view.length)

    for (var i = 0; i < view.length; i++) {
      chars[i] = String.fromCharCode(view[i])
    }
    return chars.join('')
  }

  function bufferClone(buf) {
    if (buf.slice) {
      return buf.slice(0)
    } else {
      var view = new Uint8Array(buf.byteLength)
      view.set(new Uint8Array(buf))
      return view.buffer
    }
  }

  function Body() {
    this.bodyUsed = false

    this._initBody = function(body) {
      this._bodyInit = body
      if (!body) {
        this._bodyText = ''
      } else if (typeof body === 'string') {
        this._bodyText = body
      } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
        this._bodyBlob = body
      } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
        this._bodyFormData = body
      } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
        this._bodyText = body.toString()
      } else if (support.arrayBuffer && support.blob && isDataView(body)) {
        this._bodyArrayBuffer = bufferClone(body.buffer)
        // IE 10-11 can't handle a DataView body.
        this._bodyInit = new Blob([this._bodyArrayBuffer])
      } else if (support.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(body) || isArrayBufferView(body))) {
        this._bodyArrayBuffer = bufferClone(body)
      } else {
        throw new Error('unsupported BodyInit type')
      }

      if (!this.headers.get('content-type')) {
        if (typeof body === 'string') {
          this.headers.set('content-type', 'text/plain;charset=UTF-8')
        } else if (this._bodyBlob && this._bodyBlob.type) {
          this.headers.set('content-type', this._bodyBlob.type)
        } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
          this.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
        }
      }
    }

    if (support.blob) {
      this.blob = function() {
        var rejected = consumed(this)
        if (rejected) {
          return rejected
        }

        if (this._bodyBlob) {
          return Promise.resolve(this._bodyBlob)
        } else if (this._bodyArrayBuffer) {
          return Promise.resolve(new Blob([this._bodyArrayBuffer]))
        } else if (this._bodyFormData) {
          throw new Error('could not read FormData body as blob')
        } else {
          return Promise.resolve(new Blob([this._bodyText]))
        }
      }

      this.arrayBuffer = function() {
        if (this._bodyArrayBuffer) {
          return consumed(this) || Promise.resolve(this._bodyArrayBuffer)
        } else {
          return this.blob().then(readBlobAsArrayBuffer)
        }
      }
    }

    this.text = function() {
      var rejected = consumed(this)
      if (rejected) {
        return rejected
      }

      if (this._bodyBlob) {
        return readBlobAsText(this._bodyBlob)
      } else if (this._bodyArrayBuffer) {
        return Promise.resolve(readArrayBufferAsText(this._bodyArrayBuffer))
      } else if (this._bodyFormData) {
        throw new Error('could not read FormData body as text')
      } else {
        return Promise.resolve(this._bodyText)
      }
    }

    if (support.formData) {
      this.formData = function() {
        return this.text().then(decode)
      }
    }

    this.json = function() {
      return this.text().then(JSON.parse)
    }

    return this
  }

  // HTTP methods whose capitalization should be normalized
  var methods = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']

  function normalizeMethod(method) {
    var upcased = method.toUpperCase()
    return (methods.indexOf(upcased) > -1) ? upcased : method
  }

  function Request(input, options) {
    options = options || {}
    var body = options.body

    if (input instanceof Request) {
      if (input.bodyUsed) {
        throw new TypeError('Already read')
      }
      this.url = input.url
      this.credentials = input.credentials
      if (!options.headers) {
        this.headers = new Headers(input.headers)
      }
      this.method = input.method
      this.mode = input.mode
      if (!body && input._bodyInit != null) {
        body = input._bodyInit
        input.bodyUsed = true
      }
    } else {
      this.url = String(input)
    }

    this.credentials = options.credentials || this.credentials || 'omit'
    if (options.headers || !this.headers) {
      this.headers = new Headers(options.headers)
    }
    this.method = normalizeMethod(options.method || this.method || 'GET')
    this.mode = options.mode || this.mode || null
    this.referrer = null

    if ((this.method === 'GET' || this.method === 'HEAD') && body) {
      throw new TypeError('Body not allowed for GET or HEAD requests')
    }
    this._initBody(body)
  }

  Request.prototype.clone = function() {
    return new Request(this, { body: this._bodyInit })
  }

  function decode(body) {
    var form = new FormData()
    body.trim().split('&').forEach(function(bytes) {
      if (bytes) {
        var split = bytes.split('=')
        var name = split.shift().replace(/\+/g, ' ')
        var value = split.join('=').replace(/\+/g, ' ')
        form.append(decodeURIComponent(name), decodeURIComponent(value))
      }
    })
    return form
  }

  function parseHeaders(rawHeaders) {
    var headers = new Headers()
    // Replace instances of \r\n and \n followed by at least one space or horizontal tab with a space
    // https://tools.ietf.org/html/rfc7230#section-3.2
    var preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ')
    preProcessedHeaders.split(/\r?\n/).forEach(function(line) {
      var parts = line.split(':')
      var key = parts.shift().trim()
      if (key) {
        var value = parts.join(':').trim()
        headers.append(key, value)
      }
    })
    return headers
  }

  Body.call(Request.prototype)

  function Response(bodyInit, options) {
    if (!options) {
      options = {}
    }

    this.type = 'default'
    this.status = options.status === undefined ? 200 : options.status
    this.ok = this.status >= 200 && this.status < 300
    this.statusText = 'statusText' in options ? options.statusText : 'OK'
    this.headers = new Headers(options.headers)
    this.url = options.url || ''
    this._initBody(bodyInit)
  }

  Body.call(Response.prototype)

  Response.prototype.clone = function() {
    return new Response(this._bodyInit, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      url: this.url
    })
  }

  Response.error = function() {
    var response = new Response(null, {status: 0, statusText: ''})
    response.type = 'error'
    return response
  }

  var redirectStatuses = [301, 302, 303, 307, 308]

  Response.redirect = function(url, status) {
    if (redirectStatuses.indexOf(status) === -1) {
      throw new RangeError('Invalid status code')
    }

    return new Response(null, {status: status, headers: {location: url}})
  }

  self.Headers = Headers
  self.Request = Request
  self.Response = Response

  self.fetch = function(input, init) {
    return new Promise(function(resolve, reject) {
      var request = new Request(input, init)
      var xhr = new XMLHttpRequest()

      xhr.onload = function() {
        var options = {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseHeaders(xhr.getAllResponseHeaders() || '')
        }
        options.url = 'responseURL' in xhr ? xhr.responseURL : options.headers.get('X-Request-URL')
        var body = 'response' in xhr ? xhr.response : xhr.responseText
        resolve(new Response(body, options))
      }

      xhr.onerror = function() {
        reject(new TypeError('Network request failed'))
      }

      xhr.ontimeout = function() {
        reject(new TypeError('Network request failed'))
      }

      xhr.open(request.method, request.url, true)

      if (request.credentials === 'include') {
        xhr.withCredentials = true
      } else if (request.credentials === 'omit') {
        xhr.withCredentials = false
      }

      if ('responseType' in xhr && support.blob) {
        xhr.responseType = 'blob'
      }

      request.headers.forEach(function(value, name) {
        xhr.setRequestHeader(name, value)
      })

      xhr.send(typeof request._bodyInit === 'undefined' ? null : request._bodyInit)
    })
  }
  self.fetch.polyfill = true
})(typeof self !== 'undefined' ? self : this);

},{}],8:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var store = 'darwin-street-food';
var version = 1;
var vendorStoreName = 'vendors';

var DBHandler = function () {
	function DBHandler() {
		_classCallCheck(this, DBHandler);

		this.pendingActions = [];
		this.connect();

		this.saveData = this.saveData.bind(this);
		this.getAllData = this.getAllData.bind(this);
		this._getAllDataForPromise = this._getAllDataForPromise.bind(this);
	}

	_createClass(DBHandler, [{
		key: 'errorHandler',
		value: function errorHandler(evt) {
			console.error('DB Error', evt.target.error);
		}
	}, {
		key: 'upgradeDB',
		value: function upgradeDB(evt) {
			var db = evt.target.result;

			if (evt.oldVersion < 1) {
				var vendorStore = db.createObjectStore(vendorStoreName, { keyPath: 'id' });
				vendorStore.createIndex('name', 'name', { unique: true });
			}
		}
	}, {
		key: 'connect',
		value: function connect() {
			var _this = this;

			var connRequest = indexedDB.open(store, version);

			connRequest.addEventListener('success', function (evt) {
				_this.db = evt.target.result;
				_this.db.addEventListener('error', _this.errorHandler);

				if (_this.pendingActions) {
					while (_this.pendingActions.length < 0) {
						_this.pendingActions.pop()();
					}
				}
			});

			connRequest.addEventListener('upgradeneeded', this.upgradeDB);

			connRequest.addEventListener('error', this.errorHandler);
		}
	}, {
		key: 'saveData',
		value: function saveData(data) {
			var _this2 = this;

			if (!this.db) {
				this.pendingActions.push(function () {
					return _this2.saveData(data);
				});
				return;
			}

			var dataArr = Array.isArray(data) ? data : [data];

			var transaction = this.db.transaction(vendorStoreName, 'readwrite');
			var vendorStore = transaction.objectStore(vendorStoreName);

			dataArr.forEach(function (vendorData) {
				return vendorStore.get(vendorData.id).onsuccess = function (evt) {
					if (evt.target.result) {
						if (JSON.stringify(evt.target.result) !== JSON.stringify(vendorData)) {
							vendorStore.put(vendorData);
						}
					} else {
						vendorStore.add(vendorData);
					}
				};
			});
		}
	}, {
		key: '_getAllDataForPromise',
		value: function _getAllDataForPromise(resolve, reject) {
			var _this3 = this;

			if (!this.db) {
				this.pendingActions.push(function () {
					return _this3._getAllDataForPromise(resolve, reject);
				});
				return;
			}
			var vendorData = [];
			var vendorStore = this.db.transaction(vendorStoreName).objectStore(vendorStoreName);
			var cursor = vendorStore.openCursor();

			cursor.onsuccess = function (evt) {
				var cursor = evt.target.result;
				if (cursor) {
					vendorData.push(cursor.value);
					return cursor.continue();
				}
				resolve(vendorData);
			};

			cursor.onerror = function (evt) {
				return reject(evt.target.error);
			};
		}
	}, {
		key: 'getAllData',
		value: function getAllData() {
			return new Promise(this._getAllDataForPromise);
		}
	}]);

	return DBHandler;
}();

exports.default = DBHandler;

},{}],9:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _ejs = require('ejs');

var _ejs2 = _interopRequireDefault(_ejs);

var _timeConvert = require('./time-convert');

var _timeConvert2 = _interopRequireDefault(_timeConvert);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var templateString = undefined;
var template = undefined;
var target = undefined;

var getTarget = function getTarget() {
	if (!target) {
		target = document.querySelector('main');
	}
	return target;
};

var renderDay = function renderDay(data) {
	if (!template) {
		templateString = document.getElementById('dayTemplate').innerHTML;
		template = _ejs2.default.compile(templateString);
	}

	return template(data);
};

function drawDay(day, vendors) {
	var open = [];

	vendors.forEach(function (vendor) {
		var openIndex = vendor.locations.findIndex(function (location) {
			return location.days[day].open;
		});

		if (openIndex >= 0) {
			var openLocation = vendor.locations[openIndex];
			var openDay = openLocation.days[day];

			open.push(Object.assign({}, vendor, {
				openLocation: openLocation,
				openDay: {
					day: openDay.day,
					start: (0, _timeConvert2.default)(openDay.start),
					end: (0, _timeConvert2.default)(openDay.end)
				}
			}));
		}
	});

	var content = renderDay({
		day: days[day],
		dayIndex: day,
		vendors: open
	});

	getTarget().innerHTML += content;
}

function drawDays(dayData) {
	getTarget().innerHTML = null;

	var now = new Date();
	var today = now.getDay();

	drawDay(today, dayData);
}

exports.default = drawDays;

},{"./time-convert":13,"ejs":2}],10:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
		value: true
});

var url = 'data.json';

function loadList() {
		return fetch(url).then(function (response) {
				return response.json();
		}).then(function (data) {
				return data.features ? data.features.map(function (feature) {
						return feature.properties;
				}) : undefined;
		});
};

exports.default = loadList;

},{}],11:[function(require,module,exports){
'use strict';

require('whatwg-fetch');

var _loadList = require('./load-list');

var _loadList2 = _interopRequireDefault(_loadList);

var _tidyList = require('./tidy-list');

var _tidyList2 = _interopRequireDefault(_tidyList);

var _drawDays = require('./draw-days');

var _drawDays2 = _interopRequireDefault(_drawDays);

var _dbHandler = require('./db-handler');

var _dbHandler2 = _interopRequireDefault(_dbHandler);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var dbHandler = new _dbHandler2.default();

dbHandler.getAllData().then(_drawDays2.default);

var fetchVendors = (0, _loadList2.default)().then(_tidyList2.default);

fetchVendors.then(_drawDays2.default);
fetchVendors.then(dbHandler.saveData);

if ('serviceWorker' in navigator) {
	window.addEventListener('load', function () {
		return navigator.serviceWorker.register('sw.js').catch(function (err) {
			return console.error('ServiceWorker registration failed: ', err);
		});
	});
}

},{"./db-handler":8,"./draw-days":9,"./load-list":10,"./tidy-list":12,"whatwg-fetch":7}],12:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var days = {
	'Sunday': 'Sun',
	'Monday': 'Mon',
	'Tuesday': 'Tues',
	'Wednesday': 'Wed',
	'Thursday': 'Thurs',
	'Friday': 'Fri',
	'Saturday': 'Sat'
};

function tidyList(listData) {
	return listData.filter(function (record, index) {
		return listData.findIndex(function (findRecord) {
			return findRecord.Name === record.Name;
		}) === index;
	}).map(function (record) {
		return {
			id: record.OBJECTID,
			name: record.Name,
			website: record.Website,
			type: record.Type,
			locations: listData.filter(function (locationRecord) {
				return locationRecord.Name === record.Name;
			}).map(function (locationRecord) {
				return {
					name: locationRecord.Location,
					openTimes: locationRecord.Open_Times_Description,
					days: Object.keys(days).map(function (day) {
						return {
							day: day,
							open: record[day] === 'Yes',
							start: record[days[day] + '_Start'],
							end: record[days[day] + '_End']
						};
					})
				};
			})
		};
	});
}

exports.default = tidyList;

},{}],13:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

/**
* Convert a 24 hour time to 12 hour
* from https://stackoverflow.com/questions/13898423/javascript-convert-24-hour-time-of-day-string-to-12-hour-time-with-am-pm-and-no
* @param {string} time A 24 hour time string
* @return {string} A formatted 12 hour time string
**/
function tConvert(time) {
	// Check correct time format and split into components
	time = time.toString().match(/^([01]\d|2[0-3])([0-5]\d)$/) || [time];

	if (time.length > 1) {
		// If time format correct
		var suffix = time[1] < 12 ? 'AM' : 'PM'; // Set AM/PM
		var hours = time[1] % 12 || 12; // Adjust hours
		var minutes = time[2];

		return hours + ':' + minutes + suffix;
	}
	return time;
}

exports.default = tConvert;

},{}]},{},[11])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9saWIvX2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL2Vqcy9saWIvZWpzLmpzIiwibm9kZV9tb2R1bGVzL2Vqcy9saWIvdXRpbHMuanMiLCJub2RlX21vZHVsZXMvZWpzL3BhY2thZ2UuanNvbiIsIm5vZGVfbW9kdWxlcy9wYXRoLWJyb3dzZXJpZnkvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3doYXR3Zy1mZXRjaC9mZXRjaC5qcyIsInNyYy9qcy9kYi1oYW5kbGVyLmpzIiwic3JjL2pzL2RyYXctZGF5cy5qcyIsInNyYy9qcy9sb2FkLWxpc3QuanMiLCJzcmMvanMvc3RhcnQuanMiLCJzcmMvanMvdGlkeS1saXN0LmpzIiwic3JjL2pzL3RpbWUtY29udmVydC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzM2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2hGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7O0FDbGRBLElBQU0sUUFBUSxvQkFBZDtBQUNBLElBQU0sVUFBVSxDQUFoQjtBQUNBLElBQU0sa0JBQWtCLFNBQXhCOztJQUVNLFM7QUFDTCxzQkFBYztBQUFBOztBQUViLE9BQUssY0FBTCxHQUFzQixFQUF0QjtBQUNBLE9BQUssT0FBTDs7QUFFQSxPQUFLLFFBQUwsR0FBZ0IsS0FBSyxRQUFMLENBQWMsSUFBZCxDQUFtQixJQUFuQixDQUFoQjtBQUNBLE9BQUssVUFBTCxHQUFrQixLQUFLLFVBQUwsQ0FBZ0IsSUFBaEIsQ0FBcUIsSUFBckIsQ0FBbEI7QUFDQSxPQUFLLHFCQUFMLEdBQTZCLEtBQUsscUJBQUwsQ0FBMkIsSUFBM0IsQ0FBZ0MsSUFBaEMsQ0FBN0I7QUFDQTs7OzsrQkFFWSxHLEVBQUs7QUFDakIsV0FBUSxLQUFSLENBQWMsVUFBZCxFQUEwQixJQUFJLE1BQUosQ0FBVyxLQUFyQztBQUNBOzs7NEJBRVMsRyxFQUFLO0FBQ2QsT0FBTSxLQUFLLElBQUksTUFBSixDQUFXLE1BQXRCOztBQUVBLE9BQUcsSUFBSSxVQUFKLEdBQWlCLENBQXBCLEVBQXVCO0FBQ3RCLFFBQU0sY0FBYyxHQUFHLGlCQUFILENBQXFCLGVBQXJCLEVBQXNDLEVBQUMsU0FBUyxJQUFWLEVBQXRDLENBQXBCO0FBQ0EsZ0JBQVksV0FBWixDQUF3QixNQUF4QixFQUFnQyxNQUFoQyxFQUF3QyxFQUFDLFFBQVEsSUFBVCxFQUF4QztBQUNBO0FBQ0Q7Ozs0QkFFUztBQUFBOztBQUNULE9BQU0sY0FBYyxVQUFVLElBQVYsQ0FBZSxLQUFmLEVBQXNCLE9BQXRCLENBQXBCOztBQUVBLGVBQVksZ0JBQVosQ0FBNkIsU0FBN0IsRUFBd0MsVUFBQyxHQUFELEVBQVM7QUFDaEQsVUFBSyxFQUFMLEdBQVUsSUFBSSxNQUFKLENBQVcsTUFBckI7QUFDQSxVQUFLLEVBQUwsQ0FBUSxnQkFBUixDQUF5QixPQUF6QixFQUFrQyxNQUFLLFlBQXZDOztBQUVBLFFBQUcsTUFBSyxjQUFSLEVBQXdCO0FBQ3ZCLFlBQU0sTUFBSyxjQUFMLENBQW9CLE1BQXBCLEdBQTZCLENBQW5DLEVBQXNDO0FBQ3JDLFlBQUssY0FBTCxDQUFvQixHQUFwQjtBQUNBO0FBQ0Q7QUFDRCxJQVREOztBQVdBLGVBQVksZ0JBQVosQ0FBNkIsZUFBN0IsRUFBOEMsS0FBSyxTQUFuRDs7QUFFQSxlQUFZLGdCQUFaLENBQTZCLE9BQTdCLEVBQXNDLEtBQUssWUFBM0M7QUFDQTs7OzJCQUVRLEksRUFBTTtBQUFBOztBQUNkLE9BQUcsQ0FBQyxLQUFLLEVBQVQsRUFBYTtBQUNaLFNBQUssY0FBTCxDQUFvQixJQUFwQixDQUF5QjtBQUFBLFlBQU0sT0FBSyxRQUFMLENBQWMsSUFBZCxDQUFOO0FBQUEsS0FBekI7QUFDQTtBQUNBOztBQUVELE9BQU0sVUFBVSxNQUFNLE9BQU4sQ0FBYyxJQUFkLElBQ2IsSUFEYSxHQUViLENBQUMsSUFBRCxDQUZIOztBQUlBLE9BQU0sY0FBYyxLQUFLLEVBQUwsQ0FBUSxXQUFSLENBQW9CLGVBQXBCLEVBQXFDLFdBQXJDLENBQXBCO0FBQ0EsT0FBSSxjQUFjLFlBQVksV0FBWixDQUF3QixlQUF4QixDQUFsQjs7QUFFQSxXQUFRLE9BQVIsQ0FBZ0IsVUFBQyxVQUFEO0FBQUEsV0FBZ0IsWUFDOUIsR0FEOEIsQ0FDMUIsV0FBVyxFQURlLEVBRTlCLFNBRjhCLEdBRWxCLFVBQUMsR0FBRCxFQUFTO0FBQ3JCLFNBQUcsSUFBSSxNQUFKLENBQVcsTUFBZCxFQUFzQjtBQUNyQixVQUFHLEtBQUssU0FBTCxDQUFlLElBQUksTUFBSixDQUFXLE1BQTFCLE1BQXNDLEtBQUssU0FBTCxDQUFlLFVBQWYsQ0FBekMsRUFBcUU7QUFDcEUsbUJBQVksR0FBWixDQUFnQixVQUFoQjtBQUNBO0FBQ0QsTUFKRCxNQUlPO0FBQ04sa0JBQVksR0FBWixDQUFnQixVQUFoQjtBQUNBO0FBQ0QsS0FWYztBQUFBLElBQWhCO0FBWUE7Ozt3Q0FFcUIsTyxFQUFTLE0sRUFBUTtBQUFBOztBQUN0QyxPQUFHLENBQUMsS0FBSyxFQUFULEVBQWE7QUFDWixTQUFLLGNBQUwsQ0FBb0IsSUFBcEIsQ0FBeUI7QUFBQSxZQUFNLE9BQUsscUJBQUwsQ0FBMkIsT0FBM0IsRUFBb0MsTUFBcEMsQ0FBTjtBQUFBLEtBQXpCO0FBQ0E7QUFDQTtBQUNELE9BQU0sYUFBYSxFQUFuQjtBQUNBLE9BQU0sY0FBYyxLQUFLLEVBQUwsQ0FBUSxXQUFSLENBQW9CLGVBQXBCLEVBQXFDLFdBQXJDLENBQWlELGVBQWpELENBQXBCO0FBQ0EsT0FBTSxTQUFTLFlBQVksVUFBWixFQUFmOztBQUVBLFVBQU8sU0FBUCxHQUFtQixVQUFDLEdBQUQsRUFBUztBQUMzQixRQUFNLFNBQVMsSUFBSSxNQUFKLENBQVcsTUFBMUI7QUFDQSxRQUFHLE1BQUgsRUFBVztBQUNWLGdCQUFXLElBQVgsQ0FBZ0IsT0FBTyxLQUF2QjtBQUNBLFlBQU8sT0FBTyxRQUFQLEVBQVA7QUFDQTtBQUNELFlBQVEsVUFBUjtBQUNBLElBUEQ7O0FBU0EsVUFBTyxPQUFQLEdBQWlCLFVBQUMsR0FBRDtBQUFBLFdBQVMsT0FBTyxJQUFJLE1BQUosQ0FBVyxLQUFsQixDQUFUO0FBQUEsSUFBakI7QUFDQTs7OytCQUVZO0FBQ1osVUFBTyxJQUFJLE9BQUosQ0FBWSxLQUFLLHFCQUFqQixDQUFQO0FBQ0E7Ozs7OztrQkFLYSxTOzs7Ozs7Ozs7QUN0R2Y7Ozs7QUFDQTs7Ozs7O0FBRUEsSUFBTSxPQUFPLENBQUMsUUFBRCxFQUFXLFFBQVgsRUFBcUIsU0FBckIsRUFBZ0MsV0FBaEMsRUFBNkMsVUFBN0MsRUFBeUQsUUFBekQsRUFBbUUsVUFBbkUsQ0FBYjtBQUNBLElBQUksaUJBQWlCLFNBQXJCO0FBQ0EsSUFBSSxXQUFXLFNBQWY7QUFDQSxJQUFJLFNBQVMsU0FBYjs7QUFFQSxJQUFNLFlBQVksU0FBWixTQUFZLEdBQU07QUFDdkIsS0FBRyxDQUFDLE1BQUosRUFBWTtBQUNYLFdBQVMsU0FBUyxhQUFULENBQXVCLE1BQXZCLENBQVQ7QUFDQTtBQUNELFFBQU8sTUFBUDtBQUNBLENBTEQ7O0FBT0EsSUFBTSxZQUFZLFNBQVosU0FBWSxDQUFDLElBQUQsRUFBVTtBQUMzQixLQUFHLENBQUMsUUFBSixFQUFjO0FBQ2IsbUJBQWlCLFNBQVMsY0FBVCxDQUF3QixhQUF4QixFQUF1QyxTQUF4RDtBQUNBLGFBQVcsY0FBSSxPQUFKLENBQVksY0FBWixDQUFYO0FBQ0E7O0FBRUQsUUFBTyxTQUFTLElBQVQsQ0FBUDtBQUNBLENBUEQ7O0FBU0EsU0FBUyxPQUFULENBQWlCLEdBQWpCLEVBQXNCLE9BQXRCLEVBQStCO0FBQzlCLEtBQUksT0FBTyxFQUFYOztBQUVBLFNBQVEsT0FBUixDQUFnQixVQUFDLE1BQUQsRUFBWTtBQUMzQixNQUFJLFlBQVksT0FBTyxTQUFQLENBQWlCLFNBQWpCLENBQ2YsVUFBQyxRQUFEO0FBQUEsVUFBYyxTQUFTLElBQVQsQ0FBYyxHQUFkLEVBQW1CLElBQWpDO0FBQUEsR0FEZSxDQUFoQjs7QUFJQSxNQUFHLGFBQWEsQ0FBaEIsRUFBbUI7QUFDbEIsT0FBSSxlQUFlLE9BQU8sU0FBUCxDQUFpQixTQUFqQixDQUFuQjtBQUNBLE9BQUksVUFBVSxhQUFhLElBQWIsQ0FBa0IsR0FBbEIsQ0FBZDs7QUFFQSxRQUFLLElBQUwsQ0FBVSxPQUFPLE1BQVAsQ0FDVCxFQURTLEVBRVQsTUFGUyxFQUdUO0FBQ0MsOEJBREQ7QUFFQyxhQUFTO0FBQ1IsVUFBSyxRQUFRLEdBREw7QUFFUixZQUFPLDJCQUFZLFFBQVEsS0FBcEIsQ0FGQztBQUdSLFVBQUssMkJBQVksUUFBUSxHQUFwQjtBQUhHO0FBRlYsSUFIUyxDQUFWO0FBWUE7QUFFRCxFQXZCRDs7QUF5QkEsS0FBTSxVQUFVLFVBQVU7QUFDekIsT0FBSyxLQUFLLEdBQUwsQ0FEb0I7QUFFekIsWUFBVSxHQUZlO0FBR3pCLFdBQVM7QUFIZ0IsRUFBVixDQUFoQjs7QUFNQSxhQUFZLFNBQVosSUFBeUIsT0FBekI7QUFDQTs7QUFFRCxTQUFTLFFBQVQsQ0FBa0IsT0FBbEIsRUFBMkI7QUFDMUIsYUFBWSxTQUFaLEdBQXdCLElBQXhCOztBQUVBLEtBQUksTUFBTSxJQUFJLElBQUosRUFBVjtBQUNBLEtBQUksUUFBUSxJQUFJLE1BQUosRUFBWjs7QUFFQSxTQUFRLEtBQVIsRUFBZSxPQUFmO0FBR0E7O2tCQUVjLFE7Ozs7Ozs7OztBQ3ZFZixJQUFNLE1BQU0sV0FBWjs7QUFFQSxTQUFTLFFBQVQsR0FBb0I7QUFDbkIsU0FBTyxNQUFNLEdBQU4sRUFDTCxJQURLLENBQ0EsVUFBQyxRQUFEO0FBQUEsV0FBYyxTQUFTLElBQVQsRUFBZDtBQUFBLEdBREEsRUFFTCxJQUZLLENBRUEsVUFBQyxJQUFEO0FBQUEsV0FBVSxLQUFLLFFBQUwsR0FDWixLQUFLLFFBQUwsQ0FBYyxHQUFkLENBQWtCLFVBQUMsT0FBRDtBQUFBLGFBQWEsUUFBUSxVQUFyQjtBQUFBLEtBQWxCLENBRFksR0FFWixTQUZFO0FBQUEsR0FGQSxDQUFQO0FBT0E7O2tCQUVjLFE7Ozs7O0FDYmY7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7OztBQUVBLElBQU0sWUFBWSxJQUFJLG1CQUFKLEVBQWxCOztBQUVBLFVBQVUsVUFBVixHQUNFLElBREYsQ0FDTyxrQkFEUDs7QUFHQSxJQUFNLGVBQWUsMEJBQ25CLElBRG1CLENBQ2Qsa0JBRGMsQ0FBckI7O0FBR0EsYUFBYSxJQUFiLENBQWtCLGtCQUFsQjtBQUNBLGFBQWEsSUFBYixDQUFrQixVQUFVLFFBQTVCOztBQUVBLElBQUksbUJBQW1CLFNBQXZCLEVBQWtDO0FBQ2pDLFFBQU8sZ0JBQVAsQ0FBd0IsTUFBeEIsRUFBZ0M7QUFBQSxTQUFNLFVBQVUsYUFBVixDQUF3QixRQUF4QixDQUFpQyxPQUFqQyxFQUNwQyxLQURvQyxDQUM5QixVQUFDLEdBQUQ7QUFBQSxVQUFTLFFBQVEsS0FBUixDQUFjLHFDQUFkLEVBQXFELEdBQXJELENBQVQ7QUFBQSxHQUQ4QixDQUFOO0FBQUEsRUFBaEM7QUFHQTs7Ozs7Ozs7O0FDcEJELElBQU0sT0FBTztBQUNaLFdBQVUsS0FERTtBQUVaLFdBQVUsS0FGRTtBQUdaLFlBQVcsTUFIQztBQUlaLGNBQWEsS0FKRDtBQUtaLGFBQVksT0FMQTtBQU1aLFdBQVUsS0FORTtBQU9aLGFBQVk7QUFQQSxDQUFiOztBQVdBLFNBQVMsUUFBVCxDQUFrQixRQUFsQixFQUE0QjtBQUMzQixRQUFPLFNBQVMsTUFBVCxDQUFnQixVQUFDLE1BQUQsRUFBUyxLQUFUO0FBQUEsU0FBbUIsU0FBUyxTQUFULENBQW1CLFVBQUMsVUFBRDtBQUFBLFVBQWdCLFdBQVcsSUFBWCxLQUFvQixPQUFPLElBQTNDO0FBQUEsR0FBbkIsTUFBd0UsS0FBM0Y7QUFBQSxFQUFoQixFQUNMLEdBREssQ0FDRCxVQUFDLE1BQUQ7QUFBQSxTQUFhO0FBQ2pCLE9BQUksT0FBTyxRQURNO0FBRWpCLFNBQU0sT0FBTyxJQUZJO0FBR2pCLFlBQVMsT0FBTyxPQUhDO0FBSWpCLFNBQU0sT0FBTyxJQUpJO0FBS2pCLGNBQVcsU0FBUyxNQUFULENBQWdCLFVBQUMsY0FBRDtBQUFBLFdBQW9CLGVBQWUsSUFBZixLQUF3QixPQUFPLElBQW5EO0FBQUEsSUFBaEIsRUFDVCxHQURTLENBQ0wsVUFBQyxjQUFEO0FBQUEsV0FBcUI7QUFDekIsV0FBTSxlQUFlLFFBREk7QUFFekIsZ0JBQVcsZUFBZSxzQkFGRDtBQUd6QixXQUFNLE9BQU8sSUFBUCxDQUFZLElBQVosRUFDSixHQURJLENBQ0EsVUFBQyxHQUFEO0FBQUEsYUFBVTtBQUNkLGVBRGM7QUFFZCxhQUFNLE9BQU8sR0FBUCxNQUFnQixLQUZSO0FBR2QsY0FBTyxPQUFVLEtBQUssR0FBTCxDQUFWLFlBSE87QUFJZCxZQUFLLE9BQVUsS0FBSyxHQUFMLENBQVY7QUFKUyxPQUFWO0FBQUEsTUFEQTtBQUhtQixLQUFyQjtBQUFBLElBREs7QUFMTSxHQUFiO0FBQUEsRUFEQyxDQUFQO0FBbUJBOztrQkFFYyxROzs7Ozs7Ozs7QUNqQ2Y7Ozs7OztBQU1BLFNBQVMsUUFBVCxDQUFtQixJQUFuQixFQUF5QjtBQUN4QjtBQUNBLFFBQU8sS0FBSyxRQUFMLEdBQWlCLEtBQWpCLENBQXdCLDRCQUF4QixLQUF5RCxDQUFDLElBQUQsQ0FBaEU7O0FBRUEsS0FBSSxLQUFLLE1BQUwsR0FBYyxDQUFsQixFQUFxQjtBQUFFO0FBQ3RCLE1BQU0sU0FBUyxLQUFLLENBQUwsSUFBVSxFQUFWLEdBQWUsSUFBZixHQUFzQixJQUFyQyxDQURvQixDQUN1QjtBQUMzQyxNQUFNLFFBQVEsS0FBSyxDQUFMLElBQVUsRUFBVixJQUFnQixFQUE5QixDQUZvQixDQUVjO0FBQ2xDLE1BQU0sVUFBVSxLQUFLLENBQUwsQ0FBaEI7O0FBRUEsU0FBVSxLQUFWLFNBQW1CLE9BQW5CLEdBQTZCLE1BQTdCO0FBQ0E7QUFDRCxRQUFPLElBQVA7QUFDQTs7a0JBRWMsUSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsIiIsIi8qXG4gKiBFSlMgRW1iZWRkZWQgSmF2YVNjcmlwdCB0ZW1wbGF0ZXNcbiAqIENvcHlyaWdodCAyMTEyIE1hdHRoZXcgRWVybmlzc2UgKG1kZUBmbGVlZ2l4Lm9yZylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICpcbiovXG5cbid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBAZmlsZSBFbWJlZGRlZCBKYXZhU2NyaXB0IHRlbXBsYXRpbmcgZW5naW5lLiB7QGxpbmsgaHR0cDovL2Vqcy5jb31cbiAqIEBhdXRob3IgTWF0dGhldyBFZXJuaXNzZSA8bWRlQGZsZWVnaXgub3JnPlxuICogQGF1dGhvciBUaWFuY2hlbmcgXCJUaW1vdGh5XCIgR3UgPHRpbW90aHlndTk5QGdtYWlsLmNvbT5cbiAqIEBwcm9qZWN0IEVKU1xuICogQGxpY2Vuc2Uge0BsaW5rIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMCBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjB9XG4gKi9cblxuLyoqXG4gKiBFSlMgaW50ZXJuYWwgZnVuY3Rpb25zLlxuICpcbiAqIFRlY2huaWNhbGx5IHRoaXMgXCJtb2R1bGVcIiBsaWVzIGluIHRoZSBzYW1lIGZpbGUgYXMge0BsaW5rIG1vZHVsZTplanN9LCBmb3JcbiAqIHRoZSBzYWtlIG9mIG9yZ2FuaXphdGlvbiBhbGwgdGhlIHByaXZhdGUgZnVuY3Rpb25zIHJlIGdyb3VwZWQgaW50byB0aGlzXG4gKiBtb2R1bGUuXG4gKlxuICogQG1vZHVsZSBlanMtaW50ZXJuYWxcbiAqIEBwcml2YXRlXG4gKi9cblxuLyoqXG4gKiBFbWJlZGRlZCBKYXZhU2NyaXB0IHRlbXBsYXRpbmcgZW5naW5lLlxuICpcbiAqIEBtb2R1bGUgZWpzXG4gKiBAcHVibGljXG4gKi9cblxudmFyIGZzID0gcmVxdWlyZSgnZnMnKTtcbnZhciBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xuXG52YXIgc2NvcGVPcHRpb25XYXJuZWQgPSBmYWxzZTtcbnZhciBfVkVSU0lPTl9TVFJJTkcgPSByZXF1aXJlKCcuLi9wYWNrYWdlLmpzb24nKS52ZXJzaW9uO1xudmFyIF9ERUZBVUxUX0RFTElNSVRFUiA9ICclJztcbnZhciBfREVGQVVMVF9MT0NBTFNfTkFNRSA9ICdsb2NhbHMnO1xudmFyIF9OQU1FID0gJ2Vqcyc7XG52YXIgX1JFR0VYX1NUUklORyA9ICcoPCUlfCUlPnw8JT18PCUtfDwlX3w8JSN8PCV8JT58LSU+fF8lPiknO1xudmFyIF9PUFRTX1BBU1NBQkxFX1dJVEhfREFUQSA9IFsnZGVsaW1pdGVyJywgJ3Njb3BlJywgJ2NvbnRleHQnLCAnZGVidWcnLCAnY29tcGlsZURlYnVnJyxcbiAgJ2NsaWVudCcsICdfd2l0aCcsICdybVdoaXRlc3BhY2UnLCAnc3RyaWN0JywgJ2ZpbGVuYW1lJywgJ2FzeW5jJ107XG4vLyBXZSBkb24ndCBhbGxvdyAnY2FjaGUnIG9wdGlvbiB0byBiZSBwYXNzZWQgaW4gdGhlIGRhdGEgb2JqIGZvclxuLy8gdGhlIG5vcm1hbCBgcmVuZGVyYCBjYWxsLCBidXQgdGhpcyBpcyB3aGVyZSBFeHByZXNzIDIgJiAzIHB1dCBpdFxuLy8gc28gd2UgbWFrZSBhbiBleGNlcHRpb24gZm9yIGByZW5kZXJGaWxlYFxudmFyIF9PUFRTX1BBU1NBQkxFX1dJVEhfREFUQV9FWFBSRVNTID0gX09QVFNfUEFTU0FCTEVfV0lUSF9EQVRBLmNvbmNhdCgnY2FjaGUnKTtcbnZhciBfQk9NID0gL15cXHVGRUZGLztcblxuLyoqXG4gKiBFSlMgdGVtcGxhdGUgZnVuY3Rpb24gY2FjaGUuIFRoaXMgY2FuIGJlIGEgTFJVIG9iamVjdCBmcm9tIGxydS1jYWNoZSBOUE1cbiAqIG1vZHVsZS4gQnkgZGVmYXVsdCwgaXQgaXMge0BsaW5rIG1vZHVsZTp1dGlscy5jYWNoZX0sIGEgc2ltcGxlIGluLXByb2Nlc3NcbiAqIGNhY2hlIHRoYXQgZ3Jvd3MgY29udGludW91c2x5LlxuICpcbiAqIEB0eXBlIHtDYWNoZX1cbiAqL1xuXG5leHBvcnRzLmNhY2hlID0gdXRpbHMuY2FjaGU7XG5cbi8qKlxuICogQ3VzdG9tIGZpbGUgbG9hZGVyLiBVc2VmdWwgZm9yIHRlbXBsYXRlIHByZXByb2Nlc3Npbmcgb3IgcmVzdHJpY3RpbmcgYWNjZXNzXG4gKiB0byBhIGNlcnRhaW4gcGFydCBvZiB0aGUgZmlsZXN5c3RlbS5cbiAqXG4gKiBAdHlwZSB7ZmlsZUxvYWRlcn1cbiAqL1xuXG5leHBvcnRzLmZpbGVMb2FkZXIgPSBmcy5yZWFkRmlsZVN5bmM7XG5cbi8qKlxuICogTmFtZSBvZiB0aGUgb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGxvY2Fscy5cbiAqXG4gKiBUaGlzIHZhcmlhYmxlIGlzIG92ZXJyaWRkZW4gYnkge0BsaW5rIE9wdGlvbnN9YC5sb2NhbHNOYW1lYCBpZiBpdCBpcyBub3RcbiAqIGB1bmRlZmluZWRgLlxuICpcbiAqIEB0eXBlIHtTdHJpbmd9XG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5sb2NhbHNOYW1lID0gX0RFRkFVTFRfTE9DQUxTX05BTUU7XG5cbi8qKlxuICogUHJvbWlzZSBpbXBsZW1lbnRhdGlvbiAtLSBkZWZhdWx0cyB0byB0aGUgbmF0aXZlIGltcGxlbWVudGF0aW9uIGlmIGF2YWlsYWJsZVxuICogVGhpcyBpcyBtb3N0bHkganVzdCBmb3IgdGVzdGFiaWxpdHlcbiAqXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5wcm9taXNlSW1wbCA9IChuZXcgRnVuY3Rpb24oJ3JldHVybiB0aGlzOycpKSgpLlByb21pc2U7XG5cbi8qKlxuICogR2V0IHRoZSBwYXRoIHRvIHRoZSBpbmNsdWRlZCBmaWxlIGZyb20gdGhlIHBhcmVudCBmaWxlIHBhdGggYW5kIHRoZVxuICogc3BlY2lmaWVkIHBhdGguXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9ICBuYW1lICAgICBzcGVjaWZpZWQgcGF0aFxuICogQHBhcmFtIHtTdHJpbmd9ICBmaWxlbmFtZSBwYXJlbnQgZmlsZSBwYXRoXG4gKiBAcGFyYW0ge0Jvb2xlYW59IGlzRGlyICAgIHBhcmVudCBmaWxlIHBhdGggd2hldGhlciBpcyBkaXJlY3RvcnlcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqL1xuZXhwb3J0cy5yZXNvbHZlSW5jbHVkZSA9IGZ1bmN0aW9uKG5hbWUsIGZpbGVuYW1lLCBpc0Rpcikge1xuICB2YXIgZGlybmFtZSA9IHBhdGguZGlybmFtZTtcbiAgdmFyIGV4dG5hbWUgPSBwYXRoLmV4dG5hbWU7XG4gIHZhciByZXNvbHZlID0gcGF0aC5yZXNvbHZlO1xuICB2YXIgaW5jbHVkZVBhdGggPSByZXNvbHZlKGlzRGlyID8gZmlsZW5hbWUgOiBkaXJuYW1lKGZpbGVuYW1lKSwgbmFtZSk7XG4gIHZhciBleHQgPSBleHRuYW1lKG5hbWUpO1xuICBpZiAoIWV4dCkge1xuICAgIGluY2x1ZGVQYXRoICs9ICcuZWpzJztcbiAgfVxuICByZXR1cm4gaW5jbHVkZVBhdGg7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgcGF0aCB0byB0aGUgaW5jbHVkZWQgZmlsZSBieSBPcHRpb25zXG4gKlxuICogQHBhcmFtICB7U3RyaW5nfSAgcGF0aCAgICBzcGVjaWZpZWQgcGF0aFxuICogQHBhcmFtICB7T3B0aW9uc30gb3B0aW9ucyBjb21waWxhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKi9cbmZ1bmN0aW9uIGdldEluY2x1ZGVQYXRoKHBhdGgsIG9wdGlvbnMpIHtcbiAgdmFyIGluY2x1ZGVQYXRoO1xuICB2YXIgZmlsZVBhdGg7XG4gIHZhciB2aWV3cyA9IG9wdGlvbnMudmlld3M7XG5cbiAgLy8gQWJzIHBhdGhcbiAgaWYgKHBhdGguY2hhckF0KDApID09ICcvJykge1xuICAgIGluY2x1ZGVQYXRoID0gZXhwb3J0cy5yZXNvbHZlSW5jbHVkZShwYXRoLnJlcGxhY2UoL15cXC8qLywnJyksIG9wdGlvbnMucm9vdCB8fCAnLycsIHRydWUpO1xuICB9XG4gIC8vIFJlbGF0aXZlIHBhdGhzXG4gIGVsc2Uge1xuICAgIC8vIExvb2sgcmVsYXRpdmUgdG8gYSBwYXNzZWQgZmlsZW5hbWUgZmlyc3RcbiAgICBpZiAob3B0aW9ucy5maWxlbmFtZSkge1xuICAgICAgZmlsZVBhdGggPSBleHBvcnRzLnJlc29sdmVJbmNsdWRlKHBhdGgsIG9wdGlvbnMuZmlsZW5hbWUpO1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7XG4gICAgICAgIGluY2x1ZGVQYXRoID0gZmlsZVBhdGg7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIFRoZW4gbG9vayBpbiBhbnkgdmlld3MgZGlyZWN0b3JpZXNcbiAgICBpZiAoIWluY2x1ZGVQYXRoKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh2aWV3cykgJiYgdmlld3Muc29tZShmdW5jdGlvbiAodikge1xuICAgICAgICBmaWxlUGF0aCA9IGV4cG9ydHMucmVzb2x2ZUluY2x1ZGUocGF0aCwgdiwgdHJ1ZSk7XG4gICAgICAgIHJldHVybiBmcy5leGlzdHNTeW5jKGZpbGVQYXRoKTtcbiAgICAgIH0pKSB7XG4gICAgICAgIGluY2x1ZGVQYXRoID0gZmlsZVBhdGg7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghaW5jbHVkZVBhdGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGZpbmQgdGhlIGluY2x1ZGUgZmlsZSBcIicgK1xuICAgICAgICAgIG9wdGlvbnMuZXNjYXBlRnVuY3Rpb24ocGF0aCkgKyAnXCInKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGluY2x1ZGVQYXRoO1xufVxuXG4vKipcbiAqIEdldCB0aGUgdGVtcGxhdGUgZnJvbSBhIHN0cmluZyBvciBhIGZpbGUsIGVpdGhlciBjb21waWxlZCBvbi10aGUtZmx5IG9yXG4gKiByZWFkIGZyb20gY2FjaGUgKGlmIGVuYWJsZWQpLCBhbmQgY2FjaGUgdGhlIHRlbXBsYXRlIGlmIG5lZWRlZC5cbiAqXG4gKiBJZiBgdGVtcGxhdGVgIGlzIG5vdCBzZXQsIHRoZSBmaWxlIHNwZWNpZmllZCBpbiBgb3B0aW9ucy5maWxlbmFtZWAgd2lsbCBiZVxuICogcmVhZC5cbiAqXG4gKiBJZiBgb3B0aW9ucy5jYWNoZWAgaXMgdHJ1ZSwgdGhpcyBmdW5jdGlvbiByZWFkcyB0aGUgZmlsZSBmcm9tXG4gKiBgb3B0aW9ucy5maWxlbmFtZWAgc28gaXQgbXVzdCBiZSBzZXQgcHJpb3IgdG8gY2FsbGluZyB0aGlzIGZ1bmN0aW9uLlxuICpcbiAqIEBtZW1iZXJvZiBtb2R1bGU6ZWpzLWludGVybmFsXG4gKiBAcGFyYW0ge09wdGlvbnN9IG9wdGlvbnMgICBjb21waWxhdGlvbiBvcHRpb25zXG4gKiBAcGFyYW0ge1N0cmluZ30gW3RlbXBsYXRlXSB0ZW1wbGF0ZSBzb3VyY2VcbiAqIEByZXR1cm4geyhUZW1wbGF0ZUZ1bmN0aW9ufENsaWVudEZ1bmN0aW9uKX1cbiAqIERlcGVuZGluZyBvbiB0aGUgdmFsdWUgb2YgYG9wdGlvbnMuY2xpZW50YCwgZWl0aGVyIHR5cGUgbWlnaHQgYmUgcmV0dXJuZWQuXG4gKiBAc3RhdGljXG4gKi9cblxuZnVuY3Rpb24gaGFuZGxlQ2FjaGUob3B0aW9ucywgdGVtcGxhdGUpIHtcbiAgdmFyIGZ1bmM7XG4gIHZhciBmaWxlbmFtZSA9IG9wdGlvbnMuZmlsZW5hbWU7XG4gIHZhciBoYXNUZW1wbGF0ZSA9IGFyZ3VtZW50cy5sZW5ndGggPiAxO1xuXG4gIGlmIChvcHRpb25zLmNhY2hlKSB7XG4gICAgaWYgKCFmaWxlbmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdjYWNoZSBvcHRpb24gcmVxdWlyZXMgYSBmaWxlbmFtZScpO1xuICAgIH1cbiAgICBmdW5jID0gZXhwb3J0cy5jYWNoZS5nZXQoZmlsZW5hbWUpO1xuICAgIGlmIChmdW5jKSB7XG4gICAgICByZXR1cm4gZnVuYztcbiAgICB9XG4gICAgaWYgKCFoYXNUZW1wbGF0ZSkge1xuICAgICAgdGVtcGxhdGUgPSBmaWxlTG9hZGVyKGZpbGVuYW1lKS50b1N0cmluZygpLnJlcGxhY2UoX0JPTSwgJycpO1xuICAgIH1cbiAgfVxuICBlbHNlIGlmICghaGFzVGVtcGxhdGUpIHtcbiAgICAvLyBpc3RhbmJ1bCBpZ25vcmUgaWY6IHNob3VsZCBub3QgaGFwcGVuIGF0IGFsbFxuICAgIGlmICghZmlsZW5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW50ZXJuYWwgRUpTIGVycm9yOiBubyBmaWxlIG5hbWUgb3IgdGVtcGxhdGUgJ1xuICAgICAgICAgICAgICAgICAgICArICdwcm92aWRlZCcpO1xuICAgIH1cbiAgICB0ZW1wbGF0ZSA9IGZpbGVMb2FkZXIoZmlsZW5hbWUpLnRvU3RyaW5nKCkucmVwbGFjZShfQk9NLCAnJyk7XG4gIH1cbiAgZnVuYyA9IGV4cG9ydHMuY29tcGlsZSh0ZW1wbGF0ZSwgb3B0aW9ucyk7XG4gIGlmIChvcHRpb25zLmNhY2hlKSB7XG4gICAgZXhwb3J0cy5jYWNoZS5zZXQoZmlsZW5hbWUsIGZ1bmMpO1xuICB9XG4gIHJldHVybiBmdW5jO1xufVxuXG4vKipcbiAqIFRyeSBjYWxsaW5nIGhhbmRsZUNhY2hlIHdpdGggdGhlIGdpdmVuIG9wdGlvbnMgYW5kIGRhdGEgYW5kIGNhbGwgdGhlXG4gKiBjYWxsYmFjayB3aXRoIHRoZSByZXN1bHQuIElmIGFuIGVycm9yIG9jY3VycywgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aFxuICogdGhlIGVycm9yLiBVc2VkIGJ5IHJlbmRlckZpbGUoKS5cbiAqXG4gKiBAbWVtYmVyb2YgbW9kdWxlOmVqcy1pbnRlcm5hbFxuICogQHBhcmFtIHtPcHRpb25zfSBvcHRpb25zICAgIGNvbXBpbGF0aW9uIG9wdGlvbnNcbiAqIEBwYXJhbSB7T2JqZWN0fSBkYXRhICAgICAgICB0ZW1wbGF0ZSBkYXRhXG4gKiBAcGFyYW0ge1JlbmRlckZpbGVDYWxsYmFja30gY2IgY2FsbGJhY2tcbiAqIEBzdGF0aWNcbiAqL1xuXG5mdW5jdGlvbiB0cnlIYW5kbGVDYWNoZShvcHRpb25zLCBkYXRhLCBjYikge1xuICB2YXIgcmVzdWx0O1xuICBpZiAoIWNiKSB7XG4gICAgaWYgKHR5cGVvZiBleHBvcnRzLnByb21pc2VJbXBsID09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBuZXcgZXhwb3J0cy5wcm9taXNlSW1wbChmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmVzdWx0ID0gaGFuZGxlQ2FjaGUob3B0aW9ucykoZGF0YSk7XG4gICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnIpIHtcbiAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2UgcHJvdmlkZSBhIGNhbGxiYWNrIGZ1bmN0aW9uJyk7XG4gICAgfVxuICB9XG4gIGVsc2Uge1xuICAgIHRyeSB7XG4gICAgICByZXN1bHQgPSBoYW5kbGVDYWNoZShvcHRpb25zKShkYXRhKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycikge1xuICAgICAgcmV0dXJuIGNiKGVycik7XG4gICAgfVxuXG4gICAgY2IobnVsbCwgcmVzdWx0KTtcbiAgfVxufVxuXG4vKipcbiAqIGZpbGVMb2FkZXIgaXMgaW5kZXBlbmRlbnRcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZmlsZVBhdGggZWpzIGZpbGUgcGF0aC5cbiAqIEByZXR1cm4ge1N0cmluZ30gVGhlIGNvbnRlbnRzIG9mIHRoZSBzcGVjaWZpZWQgZmlsZS5cbiAqIEBzdGF0aWNcbiAqL1xuXG5mdW5jdGlvbiBmaWxlTG9hZGVyKGZpbGVQYXRoKXtcbiAgcmV0dXJuIGV4cG9ydHMuZmlsZUxvYWRlcihmaWxlUGF0aCk7XG59XG5cbi8qKlxuICogR2V0IHRoZSB0ZW1wbGF0ZSBmdW5jdGlvbi5cbiAqXG4gKiBJZiBgb3B0aW9ucy5jYWNoZWAgaXMgYHRydWVgLCB0aGVuIHRoZSB0ZW1wbGF0ZSBpcyBjYWNoZWQuXG4gKlxuICogQG1lbWJlcm9mIG1vZHVsZTplanMtaW50ZXJuYWxcbiAqIEBwYXJhbSB7U3RyaW5nfSAgcGF0aCAgICBwYXRoIGZvciB0aGUgc3BlY2lmaWVkIGZpbGVcbiAqIEBwYXJhbSB7T3B0aW9uc30gb3B0aW9ucyBjb21waWxhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJuIHsoVGVtcGxhdGVGdW5jdGlvbnxDbGllbnRGdW5jdGlvbil9XG4gKiBEZXBlbmRpbmcgb24gdGhlIHZhbHVlIG9mIGBvcHRpb25zLmNsaWVudGAsIGVpdGhlciB0eXBlIG1pZ2h0IGJlIHJldHVybmVkXG4gKiBAc3RhdGljXG4gKi9cblxuZnVuY3Rpb24gaW5jbHVkZUZpbGUocGF0aCwgb3B0aW9ucykge1xuICB2YXIgb3B0cyA9IHV0aWxzLnNoYWxsb3dDb3B5KHt9LCBvcHRpb25zKTtcbiAgb3B0cy5maWxlbmFtZSA9IGdldEluY2x1ZGVQYXRoKHBhdGgsIG9wdHMpO1xuICByZXR1cm4gaGFuZGxlQ2FjaGUob3B0cyk7XG59XG5cbi8qKlxuICogR2V0IHRoZSBKYXZhU2NyaXB0IHNvdXJjZSBvZiBhbiBpbmNsdWRlZCBmaWxlLlxuICpcbiAqIEBtZW1iZXJvZiBtb2R1bGU6ZWpzLWludGVybmFsXG4gKiBAcGFyYW0ge1N0cmluZ30gIHBhdGggICAgcGF0aCBmb3IgdGhlIHNwZWNpZmllZCBmaWxlXG4gKiBAcGFyYW0ge09wdGlvbnN9IG9wdGlvbnMgY29tcGlsYXRpb24gb3B0aW9uc1xuICogQHJldHVybiB7T2JqZWN0fVxuICogQHN0YXRpY1xuICovXG5cbmZ1bmN0aW9uIGluY2x1ZGVTb3VyY2UocGF0aCwgb3B0aW9ucykge1xuICB2YXIgb3B0cyA9IHV0aWxzLnNoYWxsb3dDb3B5KHt9LCBvcHRpb25zKTtcbiAgdmFyIGluY2x1ZGVQYXRoO1xuICB2YXIgdGVtcGxhdGU7XG4gIGluY2x1ZGVQYXRoID0gZ2V0SW5jbHVkZVBhdGgocGF0aCwgb3B0cyk7XG4gIHRlbXBsYXRlID0gZmlsZUxvYWRlcihpbmNsdWRlUGF0aCkudG9TdHJpbmcoKS5yZXBsYWNlKF9CT00sICcnKTtcbiAgb3B0cy5maWxlbmFtZSA9IGluY2x1ZGVQYXRoO1xuICB2YXIgdGVtcGwgPSBuZXcgVGVtcGxhdGUodGVtcGxhdGUsIG9wdHMpO1xuICB0ZW1wbC5nZW5lcmF0ZVNvdXJjZSgpO1xuICByZXR1cm4ge1xuICAgIHNvdXJjZTogdGVtcGwuc291cmNlLFxuICAgIGZpbGVuYW1lOiBpbmNsdWRlUGF0aCxcbiAgICB0ZW1wbGF0ZTogdGVtcGxhdGVcbiAgfTtcbn1cblxuLyoqXG4gKiBSZS10aHJvdyB0aGUgZ2l2ZW4gYGVycmAgaW4gY29udGV4dCB0byB0aGUgYHN0cmAgb2YgZWpzLCBgZmlsZW5hbWVgLCBhbmRcbiAqIGBsaW5lbm9gLlxuICpcbiAqIEBpbXBsZW1lbnRzIFJldGhyb3dDYWxsYmFja1xuICogQG1lbWJlcm9mIG1vZHVsZTplanMtaW50ZXJuYWxcbiAqIEBwYXJhbSB7RXJyb3J9ICBlcnIgICAgICBFcnJvciBvYmplY3RcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgICAgICBFSlMgc291cmNlXG4gKiBAcGFyYW0ge1N0cmluZ30gZmlsZW5hbWUgZmlsZSBuYW1lIG9mIHRoZSBFSlMgZmlsZVxuICogQHBhcmFtIHtTdHJpbmd9IGxpbmVubyAgIGxpbmUgbnVtYmVyIG9mIHRoZSBlcnJvclxuICogQHN0YXRpY1xuICovXG5cbmZ1bmN0aW9uIHJldGhyb3coZXJyLCBzdHIsIGZsbm0sIGxpbmVubywgZXNjKXtcbiAgdmFyIGxpbmVzID0gc3RyLnNwbGl0KCdcXG4nKTtcbiAgdmFyIHN0YXJ0ID0gTWF0aC5tYXgobGluZW5vIC0gMywgMCk7XG4gIHZhciBlbmQgPSBNYXRoLm1pbihsaW5lcy5sZW5ndGgsIGxpbmVubyArIDMpO1xuICB2YXIgZmlsZW5hbWUgPSBlc2MoZmxubSk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmVcbiAgLy8gRXJyb3IgY29udGV4dFxuICB2YXIgY29udGV4dCA9IGxpbmVzLnNsaWNlKHN0YXJ0LCBlbmQpLm1hcChmdW5jdGlvbiAobGluZSwgaSl7XG4gICAgdmFyIGN1cnIgPSBpICsgc3RhcnQgKyAxO1xuICAgIHJldHVybiAoY3VyciA9PSBsaW5lbm8gPyAnID4+ICcgOiAnICAgICcpXG4gICAgICArIGN1cnJcbiAgICAgICsgJ3wgJ1xuICAgICAgKyBsaW5lO1xuICB9KS5qb2luKCdcXG4nKTtcblxuICAvLyBBbHRlciBleGNlcHRpb24gbWVzc2FnZVxuICBlcnIucGF0aCA9IGZpbGVuYW1lO1xuICBlcnIubWVzc2FnZSA9IChmaWxlbmFtZSB8fCAnZWpzJykgKyAnOidcbiAgICArIGxpbmVubyArICdcXG4nXG4gICAgKyBjb250ZXh0ICsgJ1xcblxcbidcbiAgICArIGVyci5tZXNzYWdlO1xuXG4gIHRocm93IGVycjtcbn1cblxuZnVuY3Rpb24gc3RyaXBTZW1pKHN0cil7XG4gIHJldHVybiBzdHIucmVwbGFjZSgvOyhcXHMqJCkvLCAnJDEnKTtcbn1cblxuLyoqXG4gKiBDb21waWxlIHRoZSBnaXZlbiBgc3RyYCBvZiBlanMgaW50byBhIHRlbXBsYXRlIGZ1bmN0aW9uLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSAgdGVtcGxhdGUgRUpTIHRlbXBsYXRlXG4gKlxuICogQHBhcmFtIHtPcHRpb25zfSBvcHRzICAgICBjb21waWxhdGlvbiBvcHRpb25zXG4gKlxuICogQHJldHVybiB7KFRlbXBsYXRlRnVuY3Rpb258Q2xpZW50RnVuY3Rpb24pfVxuICogRGVwZW5kaW5nIG9uIHRoZSB2YWx1ZSBvZiBgb3B0cy5jbGllbnRgLCBlaXRoZXIgdHlwZSBtaWdodCBiZSByZXR1cm5lZC5cbiAqIE5vdGUgdGhhdCB0aGUgcmV0dXJuIHR5cGUgb2YgdGhlIGZ1bmN0aW9uIGFsc28gZGVwZW5kcyBvbiB0aGUgdmFsdWUgb2YgYG9wdHMuYXN5bmNgLlxuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMuY29tcGlsZSA9IGZ1bmN0aW9uIGNvbXBpbGUodGVtcGxhdGUsIG9wdHMpIHtcbiAgdmFyIHRlbXBsO1xuXG4gIC8vIHYxIGNvbXBhdFxuICAvLyAnc2NvcGUnIGlzICdjb250ZXh0J1xuICAvLyBGSVhNRTogUmVtb3ZlIHRoaXMgaW4gYSBmdXR1cmUgdmVyc2lvblxuICBpZiAob3B0cyAmJiBvcHRzLnNjb3BlKSB7XG4gICAgaWYgKCFzY29wZU9wdGlvbldhcm5lZCl7XG4gICAgICBjb25zb2xlLndhcm4oJ2BzY29wZWAgb3B0aW9uIGlzIGRlcHJlY2F0ZWQgYW5kIHdpbGwgYmUgcmVtb3ZlZCBpbiBFSlMgMycpO1xuICAgICAgc2NvcGVPcHRpb25XYXJuZWQgPSB0cnVlO1xuICAgIH1cbiAgICBpZiAoIW9wdHMuY29udGV4dCkge1xuICAgICAgb3B0cy5jb250ZXh0ID0gb3B0cy5zY29wZTtcbiAgICB9XG4gICAgZGVsZXRlIG9wdHMuc2NvcGU7XG4gIH1cbiAgdGVtcGwgPSBuZXcgVGVtcGxhdGUodGVtcGxhdGUsIG9wdHMpO1xuICByZXR1cm4gdGVtcGwuY29tcGlsZSgpO1xufTtcblxuLyoqXG4gKiBSZW5kZXIgdGhlIGdpdmVuIGB0ZW1wbGF0ZWAgb2YgZWpzLlxuICpcbiAqIElmIHlvdSB3b3VsZCBsaWtlIHRvIGluY2x1ZGUgb3B0aW9ucyBidXQgbm90IGRhdGEsIHlvdSBuZWVkIHRvIGV4cGxpY2l0bHlcbiAqIGNhbGwgdGhpcyBmdW5jdGlvbiB3aXRoIGBkYXRhYCBiZWluZyBhbiBlbXB0eSBvYmplY3Qgb3IgYG51bGxgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSAgIHRlbXBsYXRlIEVKUyB0ZW1wbGF0ZVxuICogQHBhcmFtIHtPYmplY3R9ICBbZGF0YT17fV0gdGVtcGxhdGUgZGF0YVxuICogQHBhcmFtIHtPcHRpb25zfSBbb3B0cz17fV0gY29tcGlsYXRpb24gYW5kIHJlbmRlcmluZyBvcHRpb25zXG4gKiBAcmV0dXJuIHsoU3RyaW5nfFByb21pc2U8U3RyaW5nPil9XG4gKiBSZXR1cm4gdmFsdWUgdHlwZSBkZXBlbmRzIG9uIGBvcHRzLmFzeW5jYC5cbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLnJlbmRlciA9IGZ1bmN0aW9uICh0ZW1wbGF0ZSwgZCwgbykge1xuICB2YXIgZGF0YSA9IGQgfHwge307XG4gIHZhciBvcHRzID0gbyB8fCB7fTtcblxuICAvLyBObyBvcHRpb25zIG9iamVjdCAtLSBpZiB0aGVyZSBhcmUgb3B0aW9ueSBuYW1lc1xuICAvLyBpbiB0aGUgZGF0YSwgY29weSB0aGVtIHRvIG9wdGlvbnNcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT0gMikge1xuICAgIHV0aWxzLnNoYWxsb3dDb3B5RnJvbUxpc3Qob3B0cywgZGF0YSwgX09QVFNfUEFTU0FCTEVfV0lUSF9EQVRBKTtcbiAgfVxuXG4gIHJldHVybiBoYW5kbGVDYWNoZShvcHRzLCB0ZW1wbGF0ZSkoZGF0YSk7XG59O1xuXG4vKipcbiAqIFJlbmRlciBhbiBFSlMgZmlsZSBhdCB0aGUgZ2l2ZW4gYHBhdGhgIGFuZCBjYWxsYmFjayBgY2IoZXJyLCBzdHIpYC5cbiAqXG4gKiBJZiB5b3Ugd291bGQgbGlrZSB0byBpbmNsdWRlIG9wdGlvbnMgYnV0IG5vdCBkYXRhLCB5b3UgbmVlZCB0byBleHBsaWNpdGx5XG4gKiBjYWxsIHRoaXMgZnVuY3Rpb24gd2l0aCBgZGF0YWAgYmVpbmcgYW4gZW1wdHkgb2JqZWN0IG9yIGBudWxsYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gICAgICAgICAgICAgcGF0aCAgICAgcGF0aCB0byB0aGUgRUpTIGZpbGVcbiAqIEBwYXJhbSB7T2JqZWN0fSAgICAgICAgICAgIFtkYXRhPXt9XSB0ZW1wbGF0ZSBkYXRhXG4gKiBAcGFyYW0ge09wdGlvbnN9ICAgICAgICAgICBbb3B0cz17fV0gY29tcGlsYXRpb24gYW5kIHJlbmRlcmluZyBvcHRpb25zXG4gKiBAcGFyYW0ge1JlbmRlckZpbGVDYWxsYmFja30gY2IgY2FsbGJhY2tcbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLnJlbmRlckZpbGUgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgdmFyIGZpbGVuYW1lID0gYXJncy5zaGlmdCgpO1xuICB2YXIgY2I7XG4gIHZhciBvcHRzID0ge2ZpbGVuYW1lOiBmaWxlbmFtZX07XG4gIHZhciBkYXRhO1xuICB2YXIgdmlld09wdHM7XG5cbiAgLy8gRG8gd2UgaGF2ZSBhIGNhbGxiYWNrP1xuICBpZiAodHlwZW9mIGFyZ3VtZW50c1thcmd1bWVudHMubGVuZ3RoIC0gMV0gPT0gJ2Z1bmN0aW9uJykge1xuICAgIGNiID0gYXJncy5wb3AoKTtcbiAgfVxuICAvLyBEbyB3ZSBoYXZlIGRhdGEvb3B0cz9cbiAgaWYgKGFyZ3MubGVuZ3RoKSB7XG4gICAgLy8gU2hvdWxkIGFsd2F5cyBoYXZlIGRhdGEgb2JqXG4gICAgZGF0YSA9IGFyZ3Muc2hpZnQoKTtcbiAgICAvLyBOb3JtYWwgcGFzc2VkIG9wdHMgKGRhdGEgb2JqICsgb3B0cyBvYmopXG4gICAgaWYgKGFyZ3MubGVuZ3RoKSB7XG4gICAgICAvLyBVc2Ugc2hhbGxvd0NvcHkgc28gd2UgZG9uJ3QgcG9sbHV0ZSBwYXNzZWQgaW4gb3B0cyBvYmogd2l0aCBuZXcgdmFsc1xuICAgICAgdXRpbHMuc2hhbGxvd0NvcHkob3B0cywgYXJncy5wb3AoKSk7XG4gICAgfVxuICAgIC8vIFNwZWNpYWwgY2FzaW5nIGZvciBFeHByZXNzIChzZXR0aW5ncyArIG9wdHMtaW4tZGF0YSlcbiAgICBlbHNlIHtcbiAgICAgIC8vIEV4cHJlc3MgMyBhbmQgNFxuICAgICAgaWYgKGRhdGEuc2V0dGluZ3MpIHtcbiAgICAgICAgLy8gUHVsbCBhIGZldyB0aGluZ3MgZnJvbSBrbm93biBsb2NhdGlvbnNcbiAgICAgICAgaWYgKGRhdGEuc2V0dGluZ3Mudmlld3MpIHtcbiAgICAgICAgICBvcHRzLnZpZXdzID0gZGF0YS5zZXR0aW5ncy52aWV3cztcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGF0YS5zZXR0aW5nc1sndmlldyBjYWNoZSddKSB7XG4gICAgICAgICAgb3B0cy5jYWNoZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVW5kb2N1bWVudGVkIGFmdGVyIEV4cHJlc3MgMiwgYnV0IHN0aWxsIHVzYWJsZSwgZXNwLiBmb3JcbiAgICAgICAgLy8gaXRlbXMgdGhhdCBhcmUgdW5zYWZlIHRvIGJlIHBhc3NlZCBhbG9uZyB3aXRoIGRhdGEsIGxpa2UgYHJvb3RgXG4gICAgICAgIHZpZXdPcHRzID0gZGF0YS5zZXR0aW5nc1sndmlldyBvcHRpb25zJ107XG4gICAgICAgIGlmICh2aWV3T3B0cykge1xuICAgICAgICAgIHV0aWxzLnNoYWxsb3dDb3B5KG9wdHMsIHZpZXdPcHRzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gRXhwcmVzcyAyIGFuZCBsb3dlciwgdmFsdWVzIHNldCBpbiBhcHAubG9jYWxzLCBvciBwZW9wbGUgd2hvIGp1c3RcbiAgICAgIC8vIHdhbnQgdG8gcGFzcyBvcHRpb25zIGluIHRoZWlyIGRhdGEuIE5PVEU6IFRoZXNlIHZhbHVlcyB3aWxsIG92ZXJyaWRlXG4gICAgICAvLyBhbnl0aGluZyBwcmV2aW91c2x5IHNldCBpbiBzZXR0aW5ncyAgb3Igc2V0dGluZ3NbJ3ZpZXcgb3B0aW9ucyddXG4gICAgICB1dGlscy5zaGFsbG93Q29weUZyb21MaXN0KG9wdHMsIGRhdGEsIF9PUFRTX1BBU1NBQkxFX1dJVEhfREFUQV9FWFBSRVNTKTtcbiAgICB9XG4gICAgb3B0cy5maWxlbmFtZSA9IGZpbGVuYW1lO1xuICB9XG4gIGVsc2Uge1xuICAgIGRhdGEgPSB7fTtcbiAgfVxuXG4gIHJldHVybiB0cnlIYW5kbGVDYWNoZShvcHRzLCBkYXRhLCBjYik7XG59O1xuXG4vKipcbiAqIENsZWFyIGludGVybWVkaWF0ZSBKYXZhU2NyaXB0IGNhY2hlLiBDYWxscyB7QGxpbmsgQ2FjaGUjcmVzZXR9LlxuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uICgpIHtcbiAgZXhwb3J0cy5jYWNoZS5yZXNldCgpO1xufTtcblxuZnVuY3Rpb24gVGVtcGxhdGUodGV4dCwgb3B0cykge1xuICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgdmFyIG9wdGlvbnMgPSB7fTtcbiAgdGhpcy50ZW1wbGF0ZVRleHQgPSB0ZXh0O1xuICB0aGlzLm1vZGUgPSBudWxsO1xuICB0aGlzLnRydW5jYXRlID0gZmFsc2U7XG4gIHRoaXMuY3VycmVudExpbmUgPSAxO1xuICB0aGlzLnNvdXJjZSA9ICcnO1xuICB0aGlzLmRlcGVuZGVuY2llcyA9IFtdO1xuICBvcHRpb25zLmNsaWVudCA9IG9wdHMuY2xpZW50IHx8IGZhbHNlO1xuICBvcHRpb25zLmVzY2FwZUZ1bmN0aW9uID0gb3B0cy5lc2NhcGUgfHwgdXRpbHMuZXNjYXBlWE1MO1xuICBvcHRpb25zLmNvbXBpbGVEZWJ1ZyA9IG9wdHMuY29tcGlsZURlYnVnICE9PSBmYWxzZTtcbiAgb3B0aW9ucy5kZWJ1ZyA9ICEhb3B0cy5kZWJ1ZztcbiAgb3B0aW9ucy5maWxlbmFtZSA9IG9wdHMuZmlsZW5hbWU7XG4gIG9wdGlvbnMuZGVsaW1pdGVyID0gb3B0cy5kZWxpbWl0ZXIgfHwgZXhwb3J0cy5kZWxpbWl0ZXIgfHwgX0RFRkFVTFRfREVMSU1JVEVSO1xuICBvcHRpb25zLnN0cmljdCA9IG9wdHMuc3RyaWN0IHx8IGZhbHNlO1xuICBvcHRpb25zLmNvbnRleHQgPSBvcHRzLmNvbnRleHQ7XG4gIG9wdGlvbnMuY2FjaGUgPSBvcHRzLmNhY2hlIHx8IGZhbHNlO1xuICBvcHRpb25zLnJtV2hpdGVzcGFjZSA9IG9wdHMucm1XaGl0ZXNwYWNlO1xuICBvcHRpb25zLnJvb3QgPSBvcHRzLnJvb3Q7XG4gIG9wdGlvbnMub3V0cHV0RnVuY3Rpb25OYW1lID0gb3B0cy5vdXRwdXRGdW5jdGlvbk5hbWU7XG4gIG9wdGlvbnMubG9jYWxzTmFtZSA9IG9wdHMubG9jYWxzTmFtZSB8fCBleHBvcnRzLmxvY2Fsc05hbWUgfHwgX0RFRkFVTFRfTE9DQUxTX05BTUU7XG4gIG9wdGlvbnMudmlld3MgPSBvcHRzLnZpZXdzO1xuICBvcHRpb25zLmFzeW5jID0gb3B0cy5hc3luYztcblxuICBpZiAob3B0aW9ucy5zdHJpY3QpIHtcbiAgICBvcHRpb25zLl93aXRoID0gZmFsc2U7XG4gIH1cbiAgZWxzZSB7XG4gICAgb3B0aW9ucy5fd2l0aCA9IHR5cGVvZiBvcHRzLl93aXRoICE9ICd1bmRlZmluZWQnID8gb3B0cy5fd2l0aCA6IHRydWU7XG4gIH1cblxuICB0aGlzLm9wdHMgPSBvcHRpb25zO1xuXG4gIHRoaXMucmVnZXggPSB0aGlzLmNyZWF0ZVJlZ2V4KCk7XG59XG5cblRlbXBsYXRlLm1vZGVzID0ge1xuICBFVkFMOiAnZXZhbCcsXG4gIEVTQ0FQRUQ6ICdlc2NhcGVkJyxcbiAgUkFXOiAncmF3JyxcbiAgQ09NTUVOVDogJ2NvbW1lbnQnLFxuICBMSVRFUkFMOiAnbGl0ZXJhbCdcbn07XG5cblRlbXBsYXRlLnByb3RvdHlwZSA9IHtcbiAgY3JlYXRlUmVnZXg6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc3RyID0gX1JFR0VYX1NUUklORztcbiAgICB2YXIgZGVsaW0gPSB1dGlscy5lc2NhcGVSZWdFeHBDaGFycyh0aGlzLm9wdHMuZGVsaW1pdGVyKTtcbiAgICBzdHIgPSBzdHIucmVwbGFjZSgvJS9nLCBkZWxpbSk7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoc3RyKTtcbiAgfSxcblxuICBjb21waWxlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNyYztcbiAgICB2YXIgZm47XG4gICAgdmFyIG9wdHMgPSB0aGlzLm9wdHM7XG4gICAgdmFyIHByZXBlbmRlZCA9ICcnO1xuICAgIHZhciBhcHBlbmRlZCA9ICcnO1xuICAgIHZhciBlc2NhcGVGbiA9IG9wdHMuZXNjYXBlRnVuY3Rpb247XG4gICAgdmFyIGFzeW5jQ3RvcjtcblxuICAgIGlmICghdGhpcy5zb3VyY2UpIHtcbiAgICAgIHRoaXMuZ2VuZXJhdGVTb3VyY2UoKTtcbiAgICAgIHByZXBlbmRlZCArPSAnICB2YXIgX19vdXRwdXQgPSBbXSwgX19hcHBlbmQgPSBfX291dHB1dC5wdXNoLmJpbmQoX19vdXRwdXQpOycgKyAnXFxuJztcbiAgICAgIGlmIChvcHRzLm91dHB1dEZ1bmN0aW9uTmFtZSkge1xuICAgICAgICBwcmVwZW5kZWQgKz0gJyAgdmFyICcgKyBvcHRzLm91dHB1dEZ1bmN0aW9uTmFtZSArICcgPSBfX2FwcGVuZDsnICsgJ1xcbic7XG4gICAgICB9XG4gICAgICBpZiAob3B0cy5fd2l0aCAhPT0gZmFsc2UpIHtcbiAgICAgICAgcHJlcGVuZGVkICs9ICAnICB3aXRoICgnICsgb3B0cy5sb2NhbHNOYW1lICsgJyB8fCB7fSkgeycgKyAnXFxuJztcbiAgICAgICAgYXBwZW5kZWQgKz0gJyAgfScgKyAnXFxuJztcbiAgICAgIH1cbiAgICAgIGFwcGVuZGVkICs9ICcgIHJldHVybiBfX291dHB1dC5qb2luKFwiXCIpOycgKyAnXFxuJztcbiAgICAgIHRoaXMuc291cmNlID0gcHJlcGVuZGVkICsgdGhpcy5zb3VyY2UgKyBhcHBlbmRlZDtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5jb21waWxlRGVidWcpIHtcbiAgICAgIHNyYyA9ICd2YXIgX19saW5lID0gMScgKyAnXFxuJ1xuICAgICAgICArICcgICwgX19saW5lcyA9ICcgKyBKU09OLnN0cmluZ2lmeSh0aGlzLnRlbXBsYXRlVGV4dCkgKyAnXFxuJ1xuICAgICAgICArICcgICwgX19maWxlbmFtZSA9ICcgKyAob3B0cy5maWxlbmFtZSA/XG4gICAgICAgIEpTT04uc3RyaW5naWZ5KG9wdHMuZmlsZW5hbWUpIDogJ3VuZGVmaW5lZCcpICsgJzsnICsgJ1xcbidcbiAgICAgICAgKyAndHJ5IHsnICsgJ1xcbidcbiAgICAgICAgKyB0aGlzLnNvdXJjZVxuICAgICAgICArICd9IGNhdGNoIChlKSB7JyArICdcXG4nXG4gICAgICAgICsgJyAgcmV0aHJvdyhlLCBfX2xpbmVzLCBfX2ZpbGVuYW1lLCBfX2xpbmUsIGVzY2FwZUZuKTsnICsgJ1xcbidcbiAgICAgICAgKyAnfScgKyAnXFxuJztcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICBzcmMgPSB0aGlzLnNvdXJjZTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5jbGllbnQpIHtcbiAgICAgIHNyYyA9ICdlc2NhcGVGbiA9IGVzY2FwZUZuIHx8ICcgKyBlc2NhcGVGbi50b1N0cmluZygpICsgJzsnICsgJ1xcbicgKyBzcmM7XG4gICAgICBpZiAob3B0cy5jb21waWxlRGVidWcpIHtcbiAgICAgICAgc3JjID0gJ3JldGhyb3cgPSByZXRocm93IHx8ICcgKyByZXRocm93LnRvU3RyaW5nKCkgKyAnOycgKyAnXFxuJyArIHNyYztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAob3B0cy5zdHJpY3QpIHtcbiAgICAgIHNyYyA9ICdcInVzZSBzdHJpY3RcIjtcXG4nICsgc3JjO1xuICAgIH1cbiAgICBpZiAob3B0cy5kZWJ1Zykge1xuICAgICAgY29uc29sZS5sb2coc3JjKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKG9wdHMuYXN5bmMpIHtcbiAgICAgICAgLy8gSGF2ZSB0byB1c2UgZ2VuZXJhdGVkIGZ1bmN0aW9uIGZvciB0aGlzLCBzaW5jZSBpbiBlbnZzIHdpdGhvdXQgc3VwcG9ydCxcbiAgICAgICAgLy8gaXQgYnJlYWtzIGluIHBhcnNpbmdcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhc3luY0N0b3IgPSAobmV3IEZ1bmN0aW9uKCdyZXR1cm4gKGFzeW5jIGZ1bmN0aW9uKCl7fSkuY29uc3RydWN0b3I7JykpKCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2goZSkge1xuICAgICAgICAgIGlmIChlIGluc3RhbmNlb2YgU3ludGF4RXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVGhpcyBlbnZpcm9ubWVudCBkb2VzIG5vdCBzdXBwb3J0IGFzeW5jL2F3YWl0Jyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGVsc2Uge1xuICAgICAgICBhc3luY0N0b3IgPSBGdW5jdGlvbjtcbiAgICAgIH1cbiAgICAgIGZuID0gbmV3IGFzeW5jQ3RvcihvcHRzLmxvY2Fsc05hbWUgKyAnLCBlc2NhcGVGbiwgaW5jbHVkZSwgcmV0aHJvdycsIHNyYyk7XG4gICAgfVxuICAgIGNhdGNoKGUpIHtcbiAgICAgIC8vIGlzdGFuYnVsIGlnbm9yZSBlbHNlXG4gICAgICBpZiAoZSBpbnN0YW5jZW9mIFN5bnRheEVycm9yKSB7XG4gICAgICAgIGlmIChvcHRzLmZpbGVuYW1lKSB7XG4gICAgICAgICAgZS5tZXNzYWdlICs9ICcgaW4gJyArIG9wdHMuZmlsZW5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgZS5tZXNzYWdlICs9ICcgd2hpbGUgY29tcGlsaW5nIGVqc1xcblxcbic7XG4gICAgICAgIGUubWVzc2FnZSArPSAnSWYgdGhlIGFib3ZlIGVycm9yIGlzIG5vdCBoZWxwZnVsLCB5b3UgbWF5IHdhbnQgdG8gdHJ5IEVKUy1MaW50Olxcbic7XG4gICAgICAgIGUubWVzc2FnZSArPSAnaHR0cHM6Ly9naXRodWIuY29tL1J5YW5aaW0vRUpTLUxpbnQnO1xuICAgICAgICBpZiAoIWUuYXN5bmMpIHtcbiAgICAgICAgICBlLm1lc3NhZ2UgKz0gJ1xcbic7XG4gICAgICAgICAgZS5tZXNzYWdlICs9ICdPciwgaWYgeW91IG1lYW50IHRvIGNyZWF0ZSBhbiBhc3luYyBmdW5jdGlvbiwgcGFzcyBhc3luYzogdHJ1ZSBhcyBhbiBvcHRpb24uJztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5jbGllbnQpIHtcbiAgICAgIGZuLmRlcGVuZGVuY2llcyA9IHRoaXMuZGVwZW5kZW5jaWVzO1xuICAgICAgcmV0dXJuIGZuO1xuICAgIH1cblxuICAgIC8vIFJldHVybiBhIGNhbGxhYmxlIGZ1bmN0aW9uIHdoaWNoIHdpbGwgZXhlY3V0ZSB0aGUgZnVuY3Rpb25cbiAgICAvLyBjcmVhdGVkIGJ5IHRoZSBzb3VyY2UtY29kZSwgd2l0aCB0aGUgcGFzc2VkIGRhdGEgYXMgbG9jYWxzXG4gICAgLy8gQWRkcyBhIGxvY2FsIGBpbmNsdWRlYCBmdW5jdGlvbiB3aGljaCBhbGxvd3MgZnVsbCByZWN1cnNpdmUgaW5jbHVkZVxuICAgIHZhciByZXR1cm5lZEZuID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgIHZhciBpbmNsdWRlID0gZnVuY3Rpb24gKHBhdGgsIGluY2x1ZGVEYXRhKSB7XG4gICAgICAgIHZhciBkID0gdXRpbHMuc2hhbGxvd0NvcHkoe30sIGRhdGEpO1xuICAgICAgICBpZiAoaW5jbHVkZURhdGEpIHtcbiAgICAgICAgICBkID0gdXRpbHMuc2hhbGxvd0NvcHkoZCwgaW5jbHVkZURhdGEpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBpbmNsdWRlRmlsZShwYXRoLCBvcHRzKShkKTtcbiAgICAgIH07XG4gICAgICByZXR1cm4gZm4uYXBwbHkob3B0cy5jb250ZXh0LCBbZGF0YSB8fCB7fSwgZXNjYXBlRm4sIGluY2x1ZGUsIHJldGhyb3ddKTtcbiAgICB9O1xuICAgIHJldHVybmVkRm4uZGVwZW5kZW5jaWVzID0gdGhpcy5kZXBlbmRlbmNpZXM7XG4gICAgcmV0dXJuIHJldHVybmVkRm47XG4gIH0sXG5cbiAgZ2VuZXJhdGVTb3VyY2U6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgb3B0cyA9IHRoaXMub3B0cztcblxuICAgIGlmIChvcHRzLnJtV2hpdGVzcGFjZSkge1xuICAgICAgLy8gSGF2ZSB0byB1c2UgdHdvIHNlcGFyYXRlIHJlcGxhY2UgaGVyZSBhcyBgXmAgYW5kIGAkYCBvcGVyYXRvcnMgZG9uJ3RcbiAgICAgIC8vIHdvcmsgd2VsbCB3aXRoIGBcXHJgLlxuICAgICAgdGhpcy50ZW1wbGF0ZVRleHQgPVxuICAgICAgICB0aGlzLnRlbXBsYXRlVGV4dC5yZXBsYWNlKC9cXHIvZywgJycpLnJlcGxhY2UoL15cXHMrfFxccyskL2dtLCAnJyk7XG4gICAgfVxuXG4gICAgLy8gU2x1cnAgc3BhY2VzIGFuZCB0YWJzIGJlZm9yZSA8JV8gYW5kIGFmdGVyIF8lPlxuICAgIHRoaXMudGVtcGxhdGVUZXh0ID1cbiAgICAgIHRoaXMudGVtcGxhdGVUZXh0LnJlcGxhY2UoL1sgXFx0XSo8JV8vZ20sICc8JV8nKS5yZXBsYWNlKC9fJT5bIFxcdF0qL2dtLCAnXyU+Jyk7XG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIG1hdGNoZXMgPSB0aGlzLnBhcnNlVGVtcGxhdGVUZXh0KCk7XG4gICAgdmFyIGQgPSB0aGlzLm9wdHMuZGVsaW1pdGVyO1xuXG4gICAgaWYgKG1hdGNoZXMgJiYgbWF0Y2hlcy5sZW5ndGgpIHtcbiAgICAgIG1hdGNoZXMuZm9yRWFjaChmdW5jdGlvbiAobGluZSwgaW5kZXgpIHtcbiAgICAgICAgdmFyIG9wZW5pbmc7XG4gICAgICAgIHZhciBjbG9zaW5nO1xuICAgICAgICB2YXIgaW5jbHVkZTtcbiAgICAgICAgdmFyIGluY2x1ZGVPcHRzO1xuICAgICAgICB2YXIgaW5jbHVkZU9iajtcbiAgICAgICAgdmFyIGluY2x1ZGVTcmM7XG4gICAgICAgIC8vIElmIHRoaXMgaXMgYW4gb3BlbmluZyB0YWcsIGNoZWNrIGZvciBjbG9zaW5nIHRhZ3NcbiAgICAgICAgLy8gRklYTUU6IE1heSBlbmQgdXAgd2l0aCBzb21lIGZhbHNlIHBvc2l0aXZlcyBoZXJlXG4gICAgICAgIC8vIEJldHRlciB0byBzdG9yZSBtb2RlcyBhcyBrL3Ygd2l0aCAnPCcgKyBkZWxpbWl0ZXIgYXMga2V5XG4gICAgICAgIC8vIFRoZW4gdGhpcyBjYW4gc2ltcGx5IGNoZWNrIGFnYWluc3QgdGhlIG1hcFxuICAgICAgICBpZiAoIGxpbmUuaW5kZXhPZignPCcgKyBkKSA9PT0gMCAgICAgICAgLy8gSWYgaXQgaXMgYSB0YWdcbiAgICAgICAgICAmJiBsaW5lLmluZGV4T2YoJzwnICsgZCArIGQpICE9PSAwKSB7IC8vIGFuZCBpcyBub3QgZXNjYXBlZFxuICAgICAgICAgIGNsb3NpbmcgPSBtYXRjaGVzW2luZGV4ICsgMl07XG4gICAgICAgICAgaWYgKCEoY2xvc2luZyA9PSBkICsgJz4nIHx8IGNsb3NpbmcgPT0gJy0nICsgZCArICc+JyB8fCBjbG9zaW5nID09ICdfJyArIGQgKyAnPicpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBmaW5kIG1hdGNoaW5nIGNsb3NlIHRhZyBmb3IgXCInICsgbGluZSArICdcIi4nKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gSEFDSzogYmFja3dhcmQtY29tcGF0IGBpbmNsdWRlYCBwcmVwcm9jZXNzb3IgZGlyZWN0aXZlc1xuICAgICAgICBpZiAoKGluY2x1ZGUgPSBsaW5lLm1hdGNoKC9eXFxzKmluY2x1ZGVcXHMrKFxcUyspLykpKSB7XG4gICAgICAgICAgb3BlbmluZyA9IG1hdGNoZXNbaW5kZXggLSAxXTtcbiAgICAgICAgICAvLyBNdXN0IGJlIGluIEVWQUwgb3IgUkFXIG1vZGVcbiAgICAgICAgICBpZiAob3BlbmluZyAmJiAob3BlbmluZyA9PSAnPCcgKyBkIHx8IG9wZW5pbmcgPT0gJzwnICsgZCArICctJyB8fCBvcGVuaW5nID09ICc8JyArIGQgKyAnXycpKSB7XG4gICAgICAgICAgICBpbmNsdWRlT3B0cyA9IHV0aWxzLnNoYWxsb3dDb3B5KHt9LCBzZWxmLm9wdHMpO1xuICAgICAgICAgICAgaW5jbHVkZU9iaiA9IGluY2x1ZGVTb3VyY2UoaW5jbHVkZVsxXSwgaW5jbHVkZU9wdHMpO1xuICAgICAgICAgICAgaWYgKHNlbGYub3B0cy5jb21waWxlRGVidWcpIHtcbiAgICAgICAgICAgICAgaW5jbHVkZVNyYyA9XG4gICAgICAgICAgICAgICAgICAnICAgIDsgKGZ1bmN0aW9uKCl7JyArICdcXG4nXG4gICAgICAgICAgICAgICAgICArICcgICAgICB2YXIgX19saW5lID0gMScgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyAnICAgICAgLCBfX2xpbmVzID0gJyArIEpTT04uc3RyaW5naWZ5KGluY2x1ZGVPYmoudGVtcGxhdGUpICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgJyAgICAgICwgX19maWxlbmFtZSA9ICcgKyBKU09OLnN0cmluZ2lmeShpbmNsdWRlT2JqLmZpbGVuYW1lKSArICc7JyArICdcXG4nXG4gICAgICAgICAgICAgICAgICArICcgICAgICB0cnkgeycgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyBpbmNsdWRlT2JqLnNvdXJjZVxuICAgICAgICAgICAgICAgICAgKyAnICAgICAgfSBjYXRjaCAoZSkgeycgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyAnICAgICAgICByZXRocm93KGUsIF9fbGluZXMsIF9fZmlsZW5hbWUsIF9fbGluZSwgZXNjYXBlRm4pOycgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyAnICAgICAgfScgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyAnICAgIDsgfSkuY2FsbCh0aGlzKScgKyAnXFxuJztcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICBpbmNsdWRlU3JjID0gJyAgICA7IChmdW5jdGlvbigpeycgKyAnXFxuJyArIGluY2x1ZGVPYmouc291cmNlICtcbiAgICAgICAgICAgICAgICAgICcgICAgOyB9KS5jYWxsKHRoaXMpJyArICdcXG4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2VsZi5zb3VyY2UgKz0gaW5jbHVkZVNyYztcbiAgICAgICAgICAgIHNlbGYuZGVwZW5kZW5jaWVzLnB1c2goZXhwb3J0cy5yZXNvbHZlSW5jbHVkZShpbmNsdWRlWzFdLFxuICAgICAgICAgICAgICBpbmNsdWRlT3B0cy5maWxlbmFtZSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzZWxmLnNjYW5MaW5lKGxpbmUpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gIH0sXG5cbiAgcGFyc2VUZW1wbGF0ZVRleHQ6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc3RyID0gdGhpcy50ZW1wbGF0ZVRleHQ7XG4gICAgdmFyIHBhdCA9IHRoaXMucmVnZXg7XG4gICAgdmFyIHJlc3VsdCA9IHBhdC5leGVjKHN0cik7XG4gICAgdmFyIGFyciA9IFtdO1xuICAgIHZhciBmaXJzdFBvcztcblxuICAgIHdoaWxlIChyZXN1bHQpIHtcbiAgICAgIGZpcnN0UG9zID0gcmVzdWx0LmluZGV4O1xuXG4gICAgICBpZiAoZmlyc3RQb3MgIT09IDApIHtcbiAgICAgICAgYXJyLnB1c2goc3RyLnN1YnN0cmluZygwLCBmaXJzdFBvcykpO1xuICAgICAgICBzdHIgPSBzdHIuc2xpY2UoZmlyc3RQb3MpO1xuICAgICAgfVxuXG4gICAgICBhcnIucHVzaChyZXN1bHRbMF0pO1xuICAgICAgc3RyID0gc3RyLnNsaWNlKHJlc3VsdFswXS5sZW5ndGgpO1xuICAgICAgcmVzdWx0ID0gcGF0LmV4ZWMoc3RyKTtcbiAgICB9XG5cbiAgICBpZiAoc3RyKSB7XG4gICAgICBhcnIucHVzaChzdHIpO1xuICAgIH1cblxuICAgIHJldHVybiBhcnI7XG4gIH0sXG5cbiAgX2FkZE91dHB1dDogZnVuY3Rpb24gKGxpbmUpIHtcbiAgICBpZiAodGhpcy50cnVuY2F0ZSkge1xuICAgICAgLy8gT25seSByZXBsYWNlIHNpbmdsZSBsZWFkaW5nIGxpbmVicmVhayBpbiB0aGUgbGluZSBhZnRlclxuICAgICAgLy8gLSU+IHRhZyAtLSB0aGlzIGlzIHRoZSBzaW5nbGUsIHRyYWlsaW5nIGxpbmVicmVha1xuICAgICAgLy8gYWZ0ZXIgdGhlIHRhZyB0aGF0IHRoZSB0cnVuY2F0aW9uIG1vZGUgcmVwbGFjZXNcbiAgICAgIC8vIEhhbmRsZSBXaW4gLyBVbml4IC8gb2xkIE1hYyBsaW5lYnJlYWtzIC0tIGRvIHRoZSBcXHJcXG5cbiAgICAgIC8vIGNvbWJvIGZpcnN0IGluIHRoZSByZWdleC1vclxuICAgICAgbGluZSA9IGxpbmUucmVwbGFjZSgvXig/OlxcclxcbnxcXHJ8XFxuKS8sICcnKTtcbiAgICAgIHRoaXMudHJ1bmNhdGUgPSBmYWxzZTtcbiAgICB9XG4gICAgZWxzZSBpZiAodGhpcy5vcHRzLnJtV2hpdGVzcGFjZSkge1xuICAgICAgLy8gcm1XaGl0ZXNwYWNlIGhhcyBhbHJlYWR5IHJlbW92ZWQgdHJhaWxpbmcgc3BhY2VzLCBqdXN0IG5lZWRcbiAgICAgIC8vIHRvIHJlbW92ZSBsaW5lYnJlYWtzXG4gICAgICBsaW5lID0gbGluZS5yZXBsYWNlKC9eXFxuLywgJycpO1xuICAgIH1cbiAgICBpZiAoIWxpbmUpIHtcbiAgICAgIHJldHVybiBsaW5lO1xuICAgIH1cblxuICAgIC8vIFByZXNlcnZlIGxpdGVyYWwgc2xhc2hlc1xuICAgIGxpbmUgPSBsaW5lLnJlcGxhY2UoL1xcXFwvZywgJ1xcXFxcXFxcJyk7XG5cbiAgICAvLyBDb252ZXJ0IGxpbmVicmVha3NcbiAgICBsaW5lID0gbGluZS5yZXBsYWNlKC9cXG4vZywgJ1xcXFxuJyk7XG4gICAgbGluZSA9IGxpbmUucmVwbGFjZSgvXFxyL2csICdcXFxccicpO1xuXG4gICAgLy8gRXNjYXBlIGRvdWJsZS1xdW90ZXNcbiAgICAvLyAtIHRoaXMgd2lsbCBiZSB0aGUgZGVsaW1pdGVyIGR1cmluZyBleGVjdXRpb25cbiAgICBsaW5lID0gbGluZS5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJyk7XG4gICAgdGhpcy5zb3VyY2UgKz0gJyAgICA7IF9fYXBwZW5kKFwiJyArIGxpbmUgKyAnXCIpJyArICdcXG4nO1xuICB9LFxuXG4gIHNjYW5MaW5lOiBmdW5jdGlvbiAobGluZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgZCA9IHRoaXMub3B0cy5kZWxpbWl0ZXI7XG4gICAgdmFyIG5ld0xpbmVDb3VudCA9IDA7XG5cbiAgICBuZXdMaW5lQ291bnQgPSAobGluZS5zcGxpdCgnXFxuJykubGVuZ3RoIC0gMSk7XG5cbiAgICBzd2l0Y2ggKGxpbmUpIHtcbiAgICBjYXNlICc8JyArIGQ6XG4gICAgY2FzZSAnPCcgKyBkICsgJ18nOlxuICAgICAgdGhpcy5tb2RlID0gVGVtcGxhdGUubW9kZXMuRVZBTDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJzwnICsgZCArICc9JzpcbiAgICAgIHRoaXMubW9kZSA9IFRlbXBsYXRlLm1vZGVzLkVTQ0FQRUQ7XG4gICAgICBicmVhaztcbiAgICBjYXNlICc8JyArIGQgKyAnLSc6XG4gICAgICB0aGlzLm1vZGUgPSBUZW1wbGF0ZS5tb2Rlcy5SQVc7XG4gICAgICBicmVhaztcbiAgICBjYXNlICc8JyArIGQgKyAnIyc6XG4gICAgICB0aGlzLm1vZGUgPSBUZW1wbGF0ZS5tb2Rlcy5DT01NRU5UO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnPCcgKyBkICsgZDpcbiAgICAgIHRoaXMubW9kZSA9IFRlbXBsYXRlLm1vZGVzLkxJVEVSQUw7XG4gICAgICB0aGlzLnNvdXJjZSArPSAnICAgIDsgX19hcHBlbmQoXCInICsgbGluZS5yZXBsYWNlKCc8JyArIGQgKyBkLCAnPCcgKyBkKSArICdcIiknICsgJ1xcbic7XG4gICAgICBicmVhaztcbiAgICBjYXNlIGQgKyBkICsgJz4nOlxuICAgICAgdGhpcy5tb2RlID0gVGVtcGxhdGUubW9kZXMuTElURVJBTDtcbiAgICAgIHRoaXMuc291cmNlICs9ICcgICAgOyBfX2FwcGVuZChcIicgKyBsaW5lLnJlcGxhY2UoZCArIGQgKyAnPicsIGQgKyAnPicpICsgJ1wiKScgKyAnXFxuJztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgZCArICc+JzpcbiAgICBjYXNlICctJyArIGQgKyAnPic6XG4gICAgY2FzZSAnXycgKyBkICsgJz4nOlxuICAgICAgaWYgKHRoaXMubW9kZSA9PSBUZW1wbGF0ZS5tb2Rlcy5MSVRFUkFMKSB7XG4gICAgICAgIHRoaXMuX2FkZE91dHB1dChsaW5lKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5tb2RlID0gbnVsbDtcbiAgICAgIHRoaXMudHJ1bmNhdGUgPSBsaW5lLmluZGV4T2YoJy0nKSA9PT0gMCB8fCBsaW5lLmluZGV4T2YoJ18nKSA9PT0gMDtcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICAvLyBJbiBzY3JpcHQgbW9kZSwgZGVwZW5kcyBvbiB0eXBlIG9mIHRhZ1xuICAgICAgaWYgKHRoaXMubW9kZSkge1xuICAgICAgICAvLyBJZiAnLy8nIGlzIGZvdW5kIHdpdGhvdXQgYSBsaW5lIGJyZWFrLCBhZGQgYSBsaW5lIGJyZWFrLlxuICAgICAgICBzd2l0Y2ggKHRoaXMubW9kZSkge1xuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLkVWQUw6XG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuRVNDQVBFRDpcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5SQVc6XG4gICAgICAgICAgaWYgKGxpbmUubGFzdEluZGV4T2YoJy8vJykgPiBsaW5lLmxhc3RJbmRleE9mKCdcXG4nKSkge1xuICAgICAgICAgICAgbGluZSArPSAnXFxuJztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3dpdGNoICh0aGlzLm1vZGUpIHtcbiAgICAgICAgLy8gSnVzdCBleGVjdXRpbmcgY29kZVxuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLkVWQUw6XG4gICAgICAgICAgdGhpcy5zb3VyY2UgKz0gJyAgICA7ICcgKyBsaW5lICsgJ1xcbic7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgLy8gRXhlYywgZXNjLCBhbmQgb3V0cHV0XG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuRVNDQVBFRDpcbiAgICAgICAgICB0aGlzLnNvdXJjZSArPSAnICAgIDsgX19hcHBlbmQoZXNjYXBlRm4oJyArIHN0cmlwU2VtaShsaW5lKSArICcpKScgKyAnXFxuJztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgICAvLyBFeGVjIGFuZCBvdXRwdXRcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5SQVc6XG4gICAgICAgICAgdGhpcy5zb3VyY2UgKz0gJyAgICA7IF9fYXBwZW5kKCcgKyBzdHJpcFNlbWkobGluZSkgKyAnKScgKyAnXFxuJztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5DT01NRU5UOlxuICAgICAgICAgIC8vIERvIG5vdGhpbmdcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgICAvLyBMaXRlcmFsIDwlJSBtb2RlLCBhcHBlbmQgYXMgcmF3IG91dHB1dFxuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLkxJVEVSQUw6XG4gICAgICAgICAgdGhpcy5fYWRkT3V0cHV0KGxpbmUpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBJbiBzdHJpbmcgbW9kZSwganVzdCBhZGQgdGhlIG91dHB1dFxuICAgICAgZWxzZSB7XG4gICAgICAgIHRoaXMuX2FkZE91dHB1dChsaW5lKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc2VsZi5vcHRzLmNvbXBpbGVEZWJ1ZyAmJiBuZXdMaW5lQ291bnQpIHtcbiAgICAgIHRoaXMuY3VycmVudExpbmUgKz0gbmV3TGluZUNvdW50O1xuICAgICAgdGhpcy5zb3VyY2UgKz0gJyAgICA7IF9fbGluZSA9ICcgKyB0aGlzLmN1cnJlbnRMaW5lICsgJ1xcbic7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIEVzY2FwZSBjaGFyYWN0ZXJzIHJlc2VydmVkIGluIFhNTC5cbiAqXG4gKiBUaGlzIGlzIHNpbXBseSBhbiBleHBvcnQgb2Yge0BsaW5rIG1vZHVsZTp1dGlscy5lc2NhcGVYTUx9LlxuICpcbiAqIElmIGBtYXJrdXBgIGlzIGB1bmRlZmluZWRgIG9yIGBudWxsYCwgdGhlIGVtcHR5IHN0cmluZyBpcyByZXR1cm5lZC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWFya3VwIElucHV0IHN0cmluZ1xuICogQHJldHVybiB7U3RyaW5nfSBFc2NhcGVkIHN0cmluZ1xuICogQHB1YmxpY1xuICogQGZ1bmNcbiAqICovXG5leHBvcnRzLmVzY2FwZVhNTCA9IHV0aWxzLmVzY2FwZVhNTDtcblxuLyoqXG4gKiBFeHByZXNzLmpzIHN1cHBvcnQuXG4gKlxuICogVGhpcyBpcyBhbiBhbGlhcyBmb3Ige0BsaW5rIG1vZHVsZTplanMucmVuZGVyRmlsZX0sIGluIG9yZGVyIHRvIHN1cHBvcnRcbiAqIEV4cHJlc3MuanMgb3V0LW9mLXRoZS1ib3guXG4gKlxuICogQGZ1bmNcbiAqL1xuXG5leHBvcnRzLl9fZXhwcmVzcyA9IGV4cG9ydHMucmVuZGVyRmlsZTtcblxuLy8gQWRkIHJlcXVpcmUgc3VwcG9ydFxuLyogaXN0YW5idWwgaWdub3JlIGVsc2UgKi9cbmlmIChyZXF1aXJlLmV4dGVuc2lvbnMpIHtcbiAgcmVxdWlyZS5leHRlbnNpb25zWycuZWpzJ10gPSBmdW5jdGlvbiAobW9kdWxlLCBmbG5tKSB7XG4gICAgdmFyIGZpbGVuYW1lID0gZmxubSB8fCAvKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dCAqLyBtb2R1bGUuZmlsZW5hbWU7XG4gICAgdmFyIG9wdGlvbnMgPSB7XG4gICAgICBmaWxlbmFtZTogZmlsZW5hbWUsXG4gICAgICBjbGllbnQ6IHRydWVcbiAgICB9O1xuICAgIHZhciB0ZW1wbGF0ZSA9IGZpbGVMb2FkZXIoZmlsZW5hbWUpLnRvU3RyaW5nKCk7XG4gICAgdmFyIGZuID0gZXhwb3J0cy5jb21waWxlKHRlbXBsYXRlLCBvcHRpb25zKTtcbiAgICBtb2R1bGUuX2NvbXBpbGUoJ21vZHVsZS5leHBvcnRzID0gJyArIGZuLnRvU3RyaW5nKCkgKyAnOycsIGZpbGVuYW1lKTtcbiAgfTtcbn1cblxuLyoqXG4gKiBWZXJzaW9uIG9mIEVKUy5cbiAqXG4gKiBAcmVhZG9ubHlcbiAqIEB0eXBlIHtTdHJpbmd9XG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5WRVJTSU9OID0gX1ZFUlNJT05fU1RSSU5HO1xuXG4vKipcbiAqIE5hbWUgZm9yIGRldGVjdGlvbiBvZiBFSlMuXG4gKlxuICogQHJlYWRvbmx5XG4gKiBAdHlwZSB7U3RyaW5nfVxuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMubmFtZSA9IF9OQU1FO1xuXG4vKiBpc3RhbmJ1bCBpZ25vcmUgaWYgKi9cbmlmICh0eXBlb2Ygd2luZG93ICE9ICd1bmRlZmluZWQnKSB7XG4gIHdpbmRvdy5lanMgPSBleHBvcnRzO1xufVxuIiwiLypcbiAqIEVKUyBFbWJlZGRlZCBKYXZhU2NyaXB0IHRlbXBsYXRlc1xuICogQ29weXJpZ2h0IDIxMTIgTWF0dGhldyBFZXJuaXNzZSAobWRlQGZsZWVnaXgub3JnKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuKi9cblxuLyoqXG4gKiBQcml2YXRlIHV0aWxpdHkgZnVuY3Rpb25zXG4gKiBAbW9kdWxlIHV0aWxzXG4gKiBAcHJpdmF0ZVxuICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHJlZ0V4cENoYXJzID0gL1t8XFxcXHt9KClbXFxdXiQrKj8uXS9nO1xuXG4vKipcbiAqIEVzY2FwZSBjaGFyYWN0ZXJzIHJlc2VydmVkIGluIHJlZ3VsYXIgZXhwcmVzc2lvbnMuXG4gKlxuICogSWYgYHN0cmluZ2AgaXMgYHVuZGVmaW5lZGAgb3IgYG51bGxgLCB0aGUgZW1wdHkgc3RyaW5nIGlzIHJldHVybmVkLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJpbmcgSW5wdXQgc3RyaW5nXG4gKiBAcmV0dXJuIHtTdHJpbmd9IEVzY2FwZWQgc3RyaW5nXG4gKiBAc3RhdGljXG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnRzLmVzY2FwZVJlZ0V4cENoYXJzID0gZnVuY3Rpb24gKHN0cmluZykge1xuICAvLyBpc3RhbmJ1bCBpZ25vcmUgaWZcbiAgaWYgKCFzdHJpbmcpIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbiAgcmV0dXJuIFN0cmluZyhzdHJpbmcpLnJlcGxhY2UocmVnRXhwQ2hhcnMsICdcXFxcJCYnKTtcbn07XG5cbnZhciBfRU5DT0RFX0hUTUxfUlVMRVMgPSB7XG4gICcmJzogJyZhbXA7JyxcbiAgJzwnOiAnJmx0OycsXG4gICc+JzogJyZndDsnLFxuICAnXCInOiAnJiMzNDsnLFxuICBcIidcIjogJyYjMzk7J1xufTtcbnZhciBfTUFUQ0hfSFRNTCA9IC9bJjw+J1wiXS9nO1xuXG5mdW5jdGlvbiBlbmNvZGVfY2hhcihjKSB7XG4gIHJldHVybiBfRU5DT0RFX0hUTUxfUlVMRVNbY10gfHwgYztcbn1cblxuLyoqXG4gKiBTdHJpbmdpZmllZCB2ZXJzaW9uIG9mIGNvbnN0YW50cyB1c2VkIGJ5IHtAbGluayBtb2R1bGU6dXRpbHMuZXNjYXBlWE1MfS5cbiAqXG4gKiBJdCBpcyB1c2VkIGluIHRoZSBwcm9jZXNzIG9mIGdlbmVyYXRpbmcge0BsaW5rIENsaWVudEZ1bmN0aW9ufXMuXG4gKlxuICogQHJlYWRvbmx5XG4gKiBAdHlwZSB7U3RyaW5nfVxuICovXG5cbnZhciBlc2NhcGVGdW5jU3RyID1cbiAgJ3ZhciBfRU5DT0RFX0hUTUxfUlVMRVMgPSB7XFxuJ1xuKyAnICAgICAgXCImXCI6IFwiJmFtcDtcIlxcbidcbisgJyAgICAsIFwiPFwiOiBcIiZsdDtcIlxcbidcbisgJyAgICAsIFwiPlwiOiBcIiZndDtcIlxcbidcbisgJyAgICAsIFxcJ1wiXFwnOiBcIiYjMzQ7XCJcXG4nXG4rICcgICAgLCBcIlxcJ1wiOiBcIiYjMzk7XCJcXG4nXG4rICcgICAgfVxcbidcbisgJyAgLCBfTUFUQ0hfSFRNTCA9IC9bJjw+XFwnXCJdL2c7XFxuJ1xuKyAnZnVuY3Rpb24gZW5jb2RlX2NoYXIoYykge1xcbidcbisgJyAgcmV0dXJuIF9FTkNPREVfSFRNTF9SVUxFU1tjXSB8fCBjO1xcbidcbisgJ307XFxuJztcblxuLyoqXG4gKiBFc2NhcGUgY2hhcmFjdGVycyByZXNlcnZlZCBpbiBYTUwuXG4gKlxuICogSWYgYG1hcmt1cGAgaXMgYHVuZGVmaW5lZGAgb3IgYG51bGxgLCB0aGUgZW1wdHkgc3RyaW5nIGlzIHJldHVybmVkLlxuICpcbiAqIEBpbXBsZW1lbnRzIHtFc2NhcGVDYWxsYmFja31cbiAqIEBwYXJhbSB7U3RyaW5nfSBtYXJrdXAgSW5wdXQgc3RyaW5nXG4gKiBAcmV0dXJuIHtTdHJpbmd9IEVzY2FwZWQgc3RyaW5nXG4gKiBAc3RhdGljXG4gKiBAcHJpdmF0ZVxuICovXG5cbmV4cG9ydHMuZXNjYXBlWE1MID0gZnVuY3Rpb24gKG1hcmt1cCkge1xuICByZXR1cm4gbWFya3VwID09IHVuZGVmaW5lZFxuICAgID8gJydcbiAgICA6IFN0cmluZyhtYXJrdXApXG4gICAgICAucmVwbGFjZShfTUFUQ0hfSFRNTCwgZW5jb2RlX2NoYXIpO1xufTtcbmV4cG9ydHMuZXNjYXBlWE1MLnRvU3RyaW5nID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gRnVuY3Rpb24ucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodGhpcykgKyAnO1xcbicgKyBlc2NhcGVGdW5jU3RyO1xufTtcblxuLyoqXG4gKiBOYWl2ZSBjb3B5IG9mIHByb3BlcnRpZXMgZnJvbSBvbmUgb2JqZWN0IHRvIGFub3RoZXIuXG4gKiBEb2VzIG5vdCByZWN1cnNlIGludG8gbm9uLXNjYWxhciBwcm9wZXJ0aWVzXG4gKiBEb2VzIG5vdCBjaGVjayB0byBzZWUgaWYgdGhlIHByb3BlcnR5IGhhcyBhIHZhbHVlIGJlZm9yZSBjb3B5aW5nXG4gKlxuICogQHBhcmFtICB7T2JqZWN0fSB0byAgIERlc3RpbmF0aW9uIG9iamVjdFxuICogQHBhcmFtICB7T2JqZWN0fSBmcm9tIFNvdXJjZSBvYmplY3RcbiAqIEByZXR1cm4ge09iamVjdH0gICAgICBEZXN0aW5hdGlvbiBvYmplY3RcbiAqIEBzdGF0aWNcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydHMuc2hhbGxvd0NvcHkgPSBmdW5jdGlvbiAodG8sIGZyb20pIHtcbiAgZnJvbSA9IGZyb20gfHwge307XG4gIGZvciAodmFyIHAgaW4gZnJvbSkge1xuICAgIHRvW3BdID0gZnJvbVtwXTtcbiAgfVxuICByZXR1cm4gdG87XG59O1xuXG4vKipcbiAqIE5haXZlIGNvcHkgb2YgYSBsaXN0IG9mIGtleSBuYW1lcywgZnJvbSBvbmUgb2JqZWN0IHRvIGFub3RoZXIuXG4gKiBPbmx5IGNvcGllcyBwcm9wZXJ0eSBpZiBpdCBpcyBhY3R1YWxseSBkZWZpbmVkXG4gKiBEb2VzIG5vdCByZWN1cnNlIGludG8gbm9uLXNjYWxhciBwcm9wZXJ0aWVzXG4gKlxuICogQHBhcmFtICB7T2JqZWN0fSB0byAgIERlc3RpbmF0aW9uIG9iamVjdFxuICogQHBhcmFtICB7T2JqZWN0fSBmcm9tIFNvdXJjZSBvYmplY3RcbiAqIEBwYXJhbSAge0FycmF5fSBsaXN0IExpc3Qgb2YgcHJvcGVydGllcyB0byBjb3B5XG4gKiBAcmV0dXJuIHtPYmplY3R9ICAgICAgRGVzdGluYXRpb24gb2JqZWN0XG4gKiBAc3RhdGljXG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnRzLnNoYWxsb3dDb3B5RnJvbUxpc3QgPSBmdW5jdGlvbiAodG8sIGZyb20sIGxpc3QpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHAgPSBsaXN0W2ldO1xuICAgIGlmICh0eXBlb2YgZnJvbVtwXSAhPSAndW5kZWZpbmVkJykge1xuICAgICAgdG9bcF0gPSBmcm9tW3BdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdG87XG59O1xuXG4vKipcbiAqIFNpbXBsZSBpbi1wcm9jZXNzIGNhY2hlIGltcGxlbWVudGF0aW9uLiBEb2VzIG5vdCBpbXBsZW1lbnQgbGltaXRzIG9mIGFueVxuICogc29ydC5cbiAqXG4gKiBAaW1wbGVtZW50cyBDYWNoZVxuICogQHN0YXRpY1xuICogQHByaXZhdGVcbiAqL1xuZXhwb3J0cy5jYWNoZSA9IHtcbiAgX2RhdGE6IHt9LFxuICBzZXQ6IGZ1bmN0aW9uIChrZXksIHZhbCkge1xuICAgIHRoaXMuX2RhdGFba2V5XSA9IHZhbDtcbiAgfSxcbiAgZ2V0OiBmdW5jdGlvbiAoa2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFba2V5XTtcbiAgfSxcbiAgcmVzZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLl9kYXRhID0ge307XG4gIH1cbn07XG4iLCJtb2R1bGUuZXhwb3J0cz17XG4gIFwiX2Zyb21cIjogXCJlanNcIixcbiAgXCJfaWRcIjogXCJlanNAMi42LjFcIixcbiAgXCJfaW5CdW5kbGVcIjogZmFsc2UsXG4gIFwiX2ludGVncml0eVwiOiBcInNoYTUxMi0weHk0QS90d2ZyUkNua2hmazhFckRpNURxZEFzQXFlR3hodDR4a0NVcnN2aGhiUU5zN0UrNGpWMENONytOS0lZMGFIRTcyK1h2cXRCSVh6RDMxWmJYUT09XCIsXG4gIFwiX2xvY2F0aW9uXCI6IFwiL2Vqc1wiLFxuICBcIl9waGFudG9tQ2hpbGRyZW5cIjoge30sXG4gIFwiX3JlcXVlc3RlZFwiOiB7XG4gICAgXCJ0eXBlXCI6IFwidGFnXCIsXG4gICAgXCJyZWdpc3RyeVwiOiB0cnVlLFxuICAgIFwicmF3XCI6IFwiZWpzXCIsXG4gICAgXCJuYW1lXCI6IFwiZWpzXCIsXG4gICAgXCJlc2NhcGVkTmFtZVwiOiBcImVqc1wiLFxuICAgIFwicmF3U3BlY1wiOiBcIlwiLFxuICAgIFwic2F2ZVNwZWNcIjogbnVsbCxcbiAgICBcImZldGNoU3BlY1wiOiBcImxhdGVzdFwiXG4gIH0sXG4gIFwiX3JlcXVpcmVkQnlcIjogW1xuICAgIFwiI0RFVjovXCIsXG4gICAgXCIjVVNFUlwiXG4gIF0sXG4gIFwiX3Jlc29sdmVkXCI6IFwiaHR0cHM6Ly9yZWdpc3RyeS5ucG1qcy5vcmcvZWpzLy0vZWpzLTIuNi4xLnRnelwiLFxuICBcIl9zaGFzdW1cIjogXCI0OThlYzBkNDk1NjU1YWJjNmYyM2NkNjE4NjhkOTI2NDY0MDcxYWEwXCIsXG4gIFwiX3NwZWNcIjogXCJlanNcIixcbiAgXCJfd2hlcmVcIjogXCIvdmFyL3d3dy9odG1sL2hpdDIzOC9mb29kdmFuc1wiLFxuICBcImF1dGhvclwiOiB7XG4gICAgXCJuYW1lXCI6IFwiTWF0dGhldyBFZXJuaXNzZVwiLFxuICAgIFwiZW1haWxcIjogXCJtZGVAZmxlZWdpeC5vcmdcIixcbiAgICBcInVybFwiOiBcImh0dHA6Ly9mbGVlZ2l4Lm9yZ1wiXG4gIH0sXG4gIFwiYnVnc1wiOiB7XG4gICAgXCJ1cmxcIjogXCJodHRwczovL2dpdGh1Yi5jb20vbWRlL2Vqcy9pc3N1ZXNcIlxuICB9LFxuICBcImJ1bmRsZURlcGVuZGVuY2llc1wiOiBmYWxzZSxcbiAgXCJjb250cmlidXRvcnNcIjogW1xuICAgIHtcbiAgICAgIFwibmFtZVwiOiBcIlRpbW90aHkgR3VcIixcbiAgICAgIFwiZW1haWxcIjogXCJ0aW1vdGh5Z3U5OUBnbWFpbC5jb21cIixcbiAgICAgIFwidXJsXCI6IFwiaHR0cHM6Ly90aW1vdGh5Z3UuZ2l0aHViLmlvXCJcbiAgICB9XG4gIF0sXG4gIFwiZGVwZW5kZW5jaWVzXCI6IHt9LFxuICBcImRlcHJlY2F0ZWRcIjogZmFsc2UsXG4gIFwiZGVzY3JpcHRpb25cIjogXCJFbWJlZGRlZCBKYXZhU2NyaXB0IHRlbXBsYXRlc1wiLFxuICBcImRldkRlcGVuZGVuY2llc1wiOiB7XG4gICAgXCJicm93c2VyaWZ5XCI6IFwiXjEzLjEuMVwiLFxuICAgIFwiZXNsaW50XCI6IFwiXjQuMTQuMFwiLFxuICAgIFwiZ2l0LWRpcmVjdG9yeS1kZXBsb3lcIjogXCJeMS41LjFcIixcbiAgICBcImlzdGFuYnVsXCI6IFwifjAuNC4zXCIsXG4gICAgXCJqYWtlXCI6IFwiXjguMC4xNlwiLFxuICAgIFwianNkb2NcIjogXCJeMy40LjBcIixcbiAgICBcImxydS1jYWNoZVwiOiBcIl40LjAuMVwiLFxuICAgIFwibW9jaGFcIjogXCJeNS4wLjVcIixcbiAgICBcInVnbGlmeS1qc1wiOiBcIl4zLjMuMTZcIlxuICB9LFxuICBcImVuZ2luZXNcIjoge1xuICAgIFwibm9kZVwiOiBcIj49MC4xMC4wXCJcbiAgfSxcbiAgXCJob21lcGFnZVwiOiBcImh0dHBzOi8vZ2l0aHViLmNvbS9tZGUvZWpzXCIsXG4gIFwia2V5d29yZHNcIjogW1xuICAgIFwidGVtcGxhdGVcIixcbiAgICBcImVuZ2luZVwiLFxuICAgIFwiZWpzXCJcbiAgXSxcbiAgXCJsaWNlbnNlXCI6IFwiQXBhY2hlLTIuMFwiLFxuICBcIm1haW5cIjogXCIuL2xpYi9lanMuanNcIixcbiAgXCJuYW1lXCI6IFwiZWpzXCIsXG4gIFwicmVwb3NpdG9yeVwiOiB7XG4gICAgXCJ0eXBlXCI6IFwiZ2l0XCIsXG4gICAgXCJ1cmxcIjogXCJnaXQ6Ly9naXRodWIuY29tL21kZS9lanMuZ2l0XCJcbiAgfSxcbiAgXCJzY3JpcHRzXCI6IHtcbiAgICBcImNvdmVyYWdlXCI6IFwiaXN0YW5idWwgY292ZXIgbm9kZV9tb2R1bGVzL21vY2hhL2Jpbi9fbW9jaGFcIixcbiAgICBcImRldmRvY1wiOiBcImpha2UgZG9jW2Rldl1cIixcbiAgICBcImRvY1wiOiBcImpha2UgZG9jXCIsXG4gICAgXCJsaW50XCI6IFwiZXNsaW50IFxcXCIqKi8qLmpzXFxcIiBKYWtlZmlsZVwiLFxuICAgIFwidGVzdFwiOiBcImpha2UgdGVzdFwiXG4gIH0sXG4gIFwidmVyc2lvblwiOiBcIjIuNi4xXCJcbn1cbiIsIi8vIC5kaXJuYW1lLCAuYmFzZW5hbWUsIGFuZCAuZXh0bmFtZSBtZXRob2RzIGFyZSBleHRyYWN0ZWQgZnJvbSBOb2RlLmpzIHY4LjExLjEsXG4vLyBiYWNrcG9ydGVkIGFuZCB0cmFuc3BsaXRlZCB3aXRoIEJhYmVsLCB3aXRoIGJhY2t3YXJkcy1jb21wYXQgZml4ZXNcblxuLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbi8vIHJlc29sdmVzIC4gYW5kIC4uIGVsZW1lbnRzIGluIGEgcGF0aCBhcnJheSB3aXRoIGRpcmVjdG9yeSBuYW1lcyB0aGVyZVxuLy8gbXVzdCBiZSBubyBzbGFzaGVzLCBlbXB0eSBlbGVtZW50cywgb3IgZGV2aWNlIG5hbWVzIChjOlxcKSBpbiB0aGUgYXJyYXlcbi8vIChzbyBhbHNvIG5vIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHNsYXNoZXMgLSBpdCBkb2VzIG5vdCBkaXN0aW5ndWlzaFxuLy8gcmVsYXRpdmUgYW5kIGFic29sdXRlIHBhdGhzKVxuZnVuY3Rpb24gbm9ybWFsaXplQXJyYXkocGFydHMsIGFsbG93QWJvdmVSb290KSB7XG4gIC8vIGlmIHRoZSBwYXRoIHRyaWVzIHRvIGdvIGFib3ZlIHRoZSByb290LCBgdXBgIGVuZHMgdXAgPiAwXG4gIHZhciB1cCA9IDA7XG4gIGZvciAodmFyIGkgPSBwYXJ0cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIHZhciBsYXN0ID0gcGFydHNbaV07XG4gICAgaWYgKGxhc3QgPT09ICcuJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgIH0gZWxzZSBpZiAobGFzdCA9PT0gJy4uJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgICAgdXArKztcbiAgICB9IGVsc2UgaWYgKHVwKSB7XG4gICAgICBwYXJ0cy5zcGxpY2UoaSwgMSk7XG4gICAgICB1cC0tO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmIHRoZSBwYXRoIGlzIGFsbG93ZWQgdG8gZ28gYWJvdmUgdGhlIHJvb3QsIHJlc3RvcmUgbGVhZGluZyAuLnNcbiAgaWYgKGFsbG93QWJvdmVSb290KSB7XG4gICAgZm9yICg7IHVwLS07IHVwKSB7XG4gICAgICBwYXJ0cy51bnNoaWZ0KCcuLicpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwYXJ0cztcbn1cblxuLy8gcGF0aC5yZXNvbHZlKFtmcm9tIC4uLl0sIHRvKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5yZXNvbHZlID0gZnVuY3Rpb24oKSB7XG4gIHZhciByZXNvbHZlZFBhdGggPSAnJyxcbiAgICAgIHJlc29sdmVkQWJzb2x1dGUgPSBmYWxzZTtcblxuICBmb3IgKHZhciBpID0gYXJndW1lbnRzLmxlbmd0aCAtIDE7IGkgPj0gLTEgJiYgIXJlc29sdmVkQWJzb2x1dGU7IGktLSkge1xuICAgIHZhciBwYXRoID0gKGkgPj0gMCkgPyBhcmd1bWVudHNbaV0gOiBwcm9jZXNzLmN3ZCgpO1xuXG4gICAgLy8gU2tpcCBlbXB0eSBhbmQgaW52YWxpZCBlbnRyaWVzXG4gICAgaWYgKHR5cGVvZiBwYXRoICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIHRvIHBhdGgucmVzb2x2ZSBtdXN0IGJlIHN0cmluZ3MnKTtcbiAgICB9IGVsc2UgaWYgKCFwYXRoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICByZXNvbHZlZFBhdGggPSBwYXRoICsgJy8nICsgcmVzb2x2ZWRQYXRoO1xuICAgIHJlc29sdmVkQWJzb2x1dGUgPSBwYXRoLmNoYXJBdCgwKSA9PT0gJy8nO1xuICB9XG5cbiAgLy8gQXQgdGhpcyBwb2ludCB0aGUgcGF0aCBzaG91bGQgYmUgcmVzb2x2ZWQgdG8gYSBmdWxsIGFic29sdXRlIHBhdGgsIGJ1dFxuICAvLyBoYW5kbGUgcmVsYXRpdmUgcGF0aHMgdG8gYmUgc2FmZSAobWlnaHQgaGFwcGVuIHdoZW4gcHJvY2Vzcy5jd2QoKSBmYWlscylcblxuICAvLyBOb3JtYWxpemUgdGhlIHBhdGhcbiAgcmVzb2x2ZWRQYXRoID0gbm9ybWFsaXplQXJyYXkoZmlsdGVyKHJlc29sdmVkUGF0aC5zcGxpdCgnLycpLCBmdW5jdGlvbihwKSB7XG4gICAgcmV0dXJuICEhcDtcbiAgfSksICFyZXNvbHZlZEFic29sdXRlKS5qb2luKCcvJyk7XG5cbiAgcmV0dXJuICgocmVzb2x2ZWRBYnNvbHV0ZSA/ICcvJyA6ICcnKSArIHJlc29sdmVkUGF0aCkgfHwgJy4nO1xufTtcblxuLy8gcGF0aC5ub3JtYWxpemUocGF0aClcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMubm9ybWFsaXplID0gZnVuY3Rpb24ocGF0aCkge1xuICB2YXIgaXNBYnNvbHV0ZSA9IGV4cG9ydHMuaXNBYnNvbHV0ZShwYXRoKSxcbiAgICAgIHRyYWlsaW5nU2xhc2ggPSBzdWJzdHIocGF0aCwgLTEpID09PSAnLyc7XG5cbiAgLy8gTm9ybWFsaXplIHRoZSBwYXRoXG4gIHBhdGggPSBub3JtYWxpemVBcnJheShmaWx0ZXIocGF0aC5zcGxpdCgnLycpLCBmdW5jdGlvbihwKSB7XG4gICAgcmV0dXJuICEhcDtcbiAgfSksICFpc0Fic29sdXRlKS5qb2luKCcvJyk7XG5cbiAgaWYgKCFwYXRoICYmICFpc0Fic29sdXRlKSB7XG4gICAgcGF0aCA9ICcuJztcbiAgfVxuICBpZiAocGF0aCAmJiB0cmFpbGluZ1NsYXNoKSB7XG4gICAgcGF0aCArPSAnLyc7XG4gIH1cblxuICByZXR1cm4gKGlzQWJzb2x1dGUgPyAnLycgOiAnJykgKyBwYXRoO1xufTtcblxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5pc0Fic29sdXRlID0gZnVuY3Rpb24ocGF0aCkge1xuICByZXR1cm4gcGF0aC5jaGFyQXQoMCkgPT09ICcvJztcbn07XG5cbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMuam9pbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcGF0aHMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDApO1xuICByZXR1cm4gZXhwb3J0cy5ub3JtYWxpemUoZmlsdGVyKHBhdGhzLCBmdW5jdGlvbihwLCBpbmRleCkge1xuICAgIGlmICh0eXBlb2YgcCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyB0byBwYXRoLmpvaW4gbXVzdCBiZSBzdHJpbmdzJyk7XG4gICAgfVxuICAgIHJldHVybiBwO1xuICB9KS5qb2luKCcvJykpO1xufTtcblxuXG4vLyBwYXRoLnJlbGF0aXZlKGZyb20sIHRvKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5yZWxhdGl2ZSA9IGZ1bmN0aW9uKGZyb20sIHRvKSB7XG4gIGZyb20gPSBleHBvcnRzLnJlc29sdmUoZnJvbSkuc3Vic3RyKDEpO1xuICB0byA9IGV4cG9ydHMucmVzb2x2ZSh0bykuc3Vic3RyKDEpO1xuXG4gIGZ1bmN0aW9uIHRyaW0oYXJyKSB7XG4gICAgdmFyIHN0YXJ0ID0gMDtcbiAgICBmb3IgKDsgc3RhcnQgPCBhcnIubGVuZ3RoOyBzdGFydCsrKSB7XG4gICAgICBpZiAoYXJyW3N0YXJ0XSAhPT0gJycpIGJyZWFrO1xuICAgIH1cblxuICAgIHZhciBlbmQgPSBhcnIubGVuZ3RoIC0gMTtcbiAgICBmb3IgKDsgZW5kID49IDA7IGVuZC0tKSB7XG4gICAgICBpZiAoYXJyW2VuZF0gIT09ICcnKSBicmVhaztcbiAgICB9XG5cbiAgICBpZiAoc3RhcnQgPiBlbmQpIHJldHVybiBbXTtcbiAgICByZXR1cm4gYXJyLnNsaWNlKHN0YXJ0LCBlbmQgLSBzdGFydCArIDEpO1xuICB9XG5cbiAgdmFyIGZyb21QYXJ0cyA9IHRyaW0oZnJvbS5zcGxpdCgnLycpKTtcbiAgdmFyIHRvUGFydHMgPSB0cmltKHRvLnNwbGl0KCcvJykpO1xuXG4gIHZhciBsZW5ndGggPSBNYXRoLm1pbihmcm9tUGFydHMubGVuZ3RoLCB0b1BhcnRzLmxlbmd0aCk7XG4gIHZhciBzYW1lUGFydHNMZW5ndGggPSBsZW5ndGg7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZnJvbVBhcnRzW2ldICE9PSB0b1BhcnRzW2ldKSB7XG4gICAgICBzYW1lUGFydHNMZW5ndGggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgdmFyIG91dHB1dFBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSBzYW1lUGFydHNMZW5ndGg7IGkgPCBmcm9tUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXRwdXRQYXJ0cy5wdXNoKCcuLicpO1xuICB9XG5cbiAgb3V0cHV0UGFydHMgPSBvdXRwdXRQYXJ0cy5jb25jYXQodG9QYXJ0cy5zbGljZShzYW1lUGFydHNMZW5ndGgpKTtcblxuICByZXR1cm4gb3V0cHV0UGFydHMuam9pbignLycpO1xufTtcblxuZXhwb3J0cy5zZXAgPSAnLyc7XG5leHBvcnRzLmRlbGltaXRlciA9ICc6JztcblxuZXhwb3J0cy5kaXJuYW1lID0gZnVuY3Rpb24gKHBhdGgpIHtcbiAgaWYgKHR5cGVvZiBwYXRoICE9PSAnc3RyaW5nJykgcGF0aCA9IHBhdGggKyAnJztcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gJy4nO1xuICB2YXIgY29kZSA9IHBhdGguY2hhckNvZGVBdCgwKTtcbiAgdmFyIGhhc1Jvb3QgPSBjb2RlID09PSA0NyAvKi8qLztcbiAgdmFyIGVuZCA9IC0xO1xuICB2YXIgbWF0Y2hlZFNsYXNoID0gdHJ1ZTtcbiAgZm9yICh2YXIgaSA9IHBhdGgubGVuZ3RoIC0gMTsgaSA+PSAxOyAtLWkpIHtcbiAgICBjb2RlID0gcGF0aC5jaGFyQ29kZUF0KGkpO1xuICAgIGlmIChjb2RlID09PSA0NyAvKi8qLykge1xuICAgICAgICBpZiAoIW1hdGNoZWRTbGFzaCkge1xuICAgICAgICAgIGVuZCA9IGk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAvLyBXZSBzYXcgdGhlIGZpcnN0IG5vbi1wYXRoIHNlcGFyYXRvclxuICAgICAgbWF0Y2hlZFNsYXNoID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBoYXNSb290ID8gJy8nIDogJy4nO1xuICBpZiAoaGFzUm9vdCAmJiBlbmQgPT09IDEpIHtcbiAgICAvLyByZXR1cm4gJy8vJztcbiAgICAvLyBCYWNrd2FyZHMtY29tcGF0IGZpeDpcbiAgICByZXR1cm4gJy8nO1xuICB9XG4gIHJldHVybiBwYXRoLnNsaWNlKDAsIGVuZCk7XG59O1xuXG5mdW5jdGlvbiBiYXNlbmFtZShwYXRoKSB7XG4gIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHBhdGggPSBwYXRoICsgJyc7XG5cbiAgdmFyIHN0YXJ0ID0gMDtcbiAgdmFyIGVuZCA9IC0xO1xuICB2YXIgbWF0Y2hlZFNsYXNoID0gdHJ1ZTtcbiAgdmFyIGk7XG5cbiAgZm9yIChpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgIGlmIChwYXRoLmNoYXJDb2RlQXQoaSkgPT09IDQ3IC8qLyovKSB7XG4gICAgICAgIC8vIElmIHdlIHJlYWNoZWQgYSBwYXRoIHNlcGFyYXRvciB0aGF0IHdhcyBub3QgcGFydCBvZiBhIHNldCBvZiBwYXRoXG4gICAgICAgIC8vIHNlcGFyYXRvcnMgYXQgdGhlIGVuZCBvZiB0aGUgc3RyaW5nLCBzdG9wIG5vd1xuICAgICAgICBpZiAoIW1hdGNoZWRTbGFzaCkge1xuICAgICAgICAgIHN0YXJ0ID0gaSArIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZW5kID09PSAtMSkge1xuICAgICAgLy8gV2Ugc2F3IHRoZSBmaXJzdCBub24tcGF0aCBzZXBhcmF0b3IsIG1hcmsgdGhpcyBhcyB0aGUgZW5kIG9mIG91clxuICAgICAgLy8gcGF0aCBjb21wb25lbnRcbiAgICAgIG1hdGNoZWRTbGFzaCA9IGZhbHNlO1xuICAgICAgZW5kID0gaSArIDE7XG4gICAgfVxuICB9XG5cbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiAnJztcbiAgcmV0dXJuIHBhdGguc2xpY2Uoc3RhcnQsIGVuZCk7XG59XG5cbi8vIFVzZXMgYSBtaXhlZCBhcHByb2FjaCBmb3IgYmFja3dhcmRzLWNvbXBhdGliaWxpdHksIGFzIGV4dCBiZWhhdmlvciBjaGFuZ2VkXG4vLyBpbiBuZXcgTm9kZS5qcyB2ZXJzaW9ucywgc28gb25seSBiYXNlbmFtZSgpIGFib3ZlIGlzIGJhY2twb3J0ZWQgaGVyZVxuZXhwb3J0cy5iYXNlbmFtZSA9IGZ1bmN0aW9uIChwYXRoLCBleHQpIHtcbiAgdmFyIGYgPSBiYXNlbmFtZShwYXRoKTtcbiAgaWYgKGV4dCAmJiBmLnN1YnN0cigtMSAqIGV4dC5sZW5ndGgpID09PSBleHQpIHtcbiAgICBmID0gZi5zdWJzdHIoMCwgZi5sZW5ndGggLSBleHQubGVuZ3RoKTtcbiAgfVxuICByZXR1cm4gZjtcbn07XG5cbmV4cG9ydHMuZXh0bmFtZSA9IGZ1bmN0aW9uIChwYXRoKSB7XG4gIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHBhdGggPSBwYXRoICsgJyc7XG4gIHZhciBzdGFydERvdCA9IC0xO1xuICB2YXIgc3RhcnRQYXJ0ID0gMDtcbiAgdmFyIGVuZCA9IC0xO1xuICB2YXIgbWF0Y2hlZFNsYXNoID0gdHJ1ZTtcbiAgLy8gVHJhY2sgdGhlIHN0YXRlIG9mIGNoYXJhY3RlcnMgKGlmIGFueSkgd2Ugc2VlIGJlZm9yZSBvdXIgZmlyc3QgZG90IGFuZFxuICAvLyBhZnRlciBhbnkgcGF0aCBzZXBhcmF0b3Igd2UgZmluZFxuICB2YXIgcHJlRG90U3RhdGUgPSAwO1xuICBmb3IgKHZhciBpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgIHZhciBjb2RlID0gcGF0aC5jaGFyQ29kZUF0KGkpO1xuICAgIGlmIChjb2RlID09PSA0NyAvKi8qLykge1xuICAgICAgICAvLyBJZiB3ZSByZWFjaGVkIGEgcGF0aCBzZXBhcmF0b3IgdGhhdCB3YXMgbm90IHBhcnQgb2YgYSBzZXQgb2YgcGF0aFxuICAgICAgICAvLyBzZXBhcmF0b3JzIGF0IHRoZSBlbmQgb2YgdGhlIHN0cmluZywgc3RvcCBub3dcbiAgICAgICAgaWYgKCFtYXRjaGVkU2xhc2gpIHtcbiAgICAgICAgICBzdGFydFBhcnQgPSBpICsgMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICBpZiAoZW5kID09PSAtMSkge1xuICAgICAgLy8gV2Ugc2F3IHRoZSBmaXJzdCBub24tcGF0aCBzZXBhcmF0b3IsIG1hcmsgdGhpcyBhcyB0aGUgZW5kIG9mIG91clxuICAgICAgLy8gZXh0ZW5zaW9uXG4gICAgICBtYXRjaGVkU2xhc2ggPSBmYWxzZTtcbiAgICAgIGVuZCA9IGkgKyAxO1xuICAgIH1cbiAgICBpZiAoY29kZSA9PT0gNDYgLyouKi8pIHtcbiAgICAgICAgLy8gSWYgdGhpcyBpcyBvdXIgZmlyc3QgZG90LCBtYXJrIGl0IGFzIHRoZSBzdGFydCBvZiBvdXIgZXh0ZW5zaW9uXG4gICAgICAgIGlmIChzdGFydERvdCA9PT0gLTEpXG4gICAgICAgICAgc3RhcnREb3QgPSBpO1xuICAgICAgICBlbHNlIGlmIChwcmVEb3RTdGF0ZSAhPT0gMSlcbiAgICAgICAgICBwcmVEb3RTdGF0ZSA9IDE7XG4gICAgfSBlbHNlIGlmIChzdGFydERvdCAhPT0gLTEpIHtcbiAgICAgIC8vIFdlIHNhdyBhIG5vbi1kb3QgYW5kIG5vbi1wYXRoIHNlcGFyYXRvciBiZWZvcmUgb3VyIGRvdCwgc28gd2Ugc2hvdWxkXG4gICAgICAvLyBoYXZlIGEgZ29vZCBjaGFuY2UgYXQgaGF2aW5nIGEgbm9uLWVtcHR5IGV4dGVuc2lvblxuICAgICAgcHJlRG90U3RhdGUgPSAtMTtcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhcnREb3QgPT09IC0xIHx8IGVuZCA9PT0gLTEgfHxcbiAgICAgIC8vIFdlIHNhdyBhIG5vbi1kb3QgY2hhcmFjdGVyIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGUgZG90XG4gICAgICBwcmVEb3RTdGF0ZSA9PT0gMCB8fFxuICAgICAgLy8gVGhlIChyaWdodC1tb3N0KSB0cmltbWVkIHBhdGggY29tcG9uZW50IGlzIGV4YWN0bHkgJy4uJ1xuICAgICAgcHJlRG90U3RhdGUgPT09IDEgJiYgc3RhcnREb3QgPT09IGVuZCAtIDEgJiYgc3RhcnREb3QgPT09IHN0YXJ0UGFydCArIDEpIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbiAgcmV0dXJuIHBhdGguc2xpY2Uoc3RhcnREb3QsIGVuZCk7XG59O1xuXG5mdW5jdGlvbiBmaWx0ZXIgKHhzLCBmKSB7XG4gICAgaWYgKHhzLmZpbHRlcikgcmV0dXJuIHhzLmZpbHRlcihmKTtcbiAgICB2YXIgcmVzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoZih4c1tpXSwgaSwgeHMpKSByZXMucHVzaCh4c1tpXSk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG59XG5cbi8vIFN0cmluZy5wcm90b3R5cGUuc3Vic3RyIC0gbmVnYXRpdmUgaW5kZXggZG9uJ3Qgd29yayBpbiBJRThcbnZhciBzdWJzdHIgPSAnYWInLnN1YnN0cigtMSkgPT09ICdiJ1xuICAgID8gZnVuY3Rpb24gKHN0ciwgc3RhcnQsIGxlbikgeyByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKSB9XG4gICAgOiBmdW5jdGlvbiAoc3RyLCBzdGFydCwgbGVuKSB7XG4gICAgICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gc3RyLmxlbmd0aCArIHN0YXJ0O1xuICAgICAgICByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKTtcbiAgICB9XG47XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxuLy8gY2FjaGVkIGZyb20gd2hhdGV2ZXIgZ2xvYmFsIGlzIHByZXNlbnQgc28gdGhhdCB0ZXN0IHJ1bm5lcnMgdGhhdCBzdHViIGl0XG4vLyBkb24ndCBicmVhayB0aGluZ3MuICBCdXQgd2UgbmVlZCB0byB3cmFwIGl0IGluIGEgdHJ5IGNhdGNoIGluIGNhc2UgaXQgaXNcbi8vIHdyYXBwZWQgaW4gc3RyaWN0IG1vZGUgY29kZSB3aGljaCBkb2Vzbid0IGRlZmluZSBhbnkgZ2xvYmFscy4gIEl0J3MgaW5zaWRlIGFcbi8vIGZ1bmN0aW9uIGJlY2F1c2UgdHJ5L2NhdGNoZXMgZGVvcHRpbWl6ZSBpbiBjZXJ0YWluIGVuZ2luZXMuXG5cbnZhciBjYWNoZWRTZXRUaW1lb3V0O1xudmFyIGNhY2hlZENsZWFyVGltZW91dDtcblxuZnVuY3Rpb24gZGVmYXVsdFNldFRpbW91dCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NldFRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbmZ1bmN0aW9uIGRlZmF1bHRDbGVhclRpbWVvdXQgKCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY2xlYXJUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG4oZnVuY3Rpb24gKCkge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2V0VGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2YgY2xlYXJUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgIH1cbn0gKCkpXG5mdW5jdGlvbiBydW5UaW1lb3V0KGZ1bikge1xuICAgIGlmIChjYWNoZWRTZXRUaW1lb3V0ID09PSBzZXRUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICAvLyBpZiBzZXRUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkU2V0VGltZW91dCA9PT0gZGVmYXVsdFNldFRpbW91dCB8fCAhY2FjaGVkU2V0VGltZW91dCkgJiYgc2V0VGltZW91dCkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dChmdW4sIDApO1xuICAgIH0gY2F0Y2goZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwobnVsbCwgZnVuLCAwKTtcbiAgICAgICAgfSBjYXRjaChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yXG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKHRoaXMsIGZ1biwgMCk7XG4gICAgICAgIH1cbiAgICB9XG5cblxufVxuZnVuY3Rpb24gcnVuQ2xlYXJUaW1lb3V0KG1hcmtlcikge1xuICAgIGlmIChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGNsZWFyVGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICAvLyBpZiBjbGVhclRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGRlZmF1bHRDbGVhclRpbWVvdXQgfHwgIWNhY2hlZENsZWFyVGltZW91dCkgJiYgY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCAgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbChudWxsLCBtYXJrZXIpO1xuICAgICAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yLlxuICAgICAgICAgICAgLy8gU29tZSB2ZXJzaW9ucyBvZiBJLkUuIGhhdmUgZGlmZmVyZW50IHJ1bGVzIGZvciBjbGVhclRpbWVvdXQgdnMgc2V0VGltZW91dFxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKHRoaXMsIG1hcmtlcik7XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG59XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBpZiAoIWRyYWluaW5nIHx8ICFjdXJyZW50UXVldWUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBydW5UaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50UXVldWUpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0ucnVuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGN1cnJlbnRRdWV1ZSA9IG51bGw7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBydW5DbGVhclRpbWVvdXQodGltZW91dCk7XG59XG5cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUucHVzaChuZXcgSXRlbShmdW4sIGFyZ3MpKTtcbiAgICBpZiAocXVldWUubGVuZ3RoID09PSAxICYmICFkcmFpbmluZykge1xuICAgICAgICBydW5UaW1lb3V0KGRyYWluUXVldWUpO1xuICAgIH1cbn07XG5cbi8vIHY4IGxpa2VzIHByZWRpY3RpYmxlIG9iamVjdHNcbmZ1bmN0aW9uIEl0ZW0oZnVuLCBhcnJheSkge1xuICAgIHRoaXMuZnVuID0gZnVuO1xuICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbn1cbkl0ZW0ucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmZ1bi5hcHBseShudWxsLCB0aGlzLmFycmF5KTtcbn07XG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRPbmNlTGlzdGVuZXIgPSBub29wO1xuXG5wcm9jZXNzLmxpc3RlbmVycyA9IGZ1bmN0aW9uIChuYW1lKSB7IHJldHVybiBbXSB9XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwiKGZ1bmN0aW9uKHNlbGYpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIGlmIChzZWxmLmZldGNoKSB7XG4gICAgcmV0dXJuXG4gIH1cblxuICB2YXIgc3VwcG9ydCA9IHtcbiAgICBzZWFyY2hQYXJhbXM6ICdVUkxTZWFyY2hQYXJhbXMnIGluIHNlbGYsXG4gICAgaXRlcmFibGU6ICdTeW1ib2wnIGluIHNlbGYgJiYgJ2l0ZXJhdG9yJyBpbiBTeW1ib2wsXG4gICAgYmxvYjogJ0ZpbGVSZWFkZXInIGluIHNlbGYgJiYgJ0Jsb2InIGluIHNlbGYgJiYgKGZ1bmN0aW9uKCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbmV3IEJsb2IoKVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH0pKCksXG4gICAgZm9ybURhdGE6ICdGb3JtRGF0YScgaW4gc2VsZixcbiAgICBhcnJheUJ1ZmZlcjogJ0FycmF5QnVmZmVyJyBpbiBzZWxmXG4gIH1cblxuICBpZiAoc3VwcG9ydC5hcnJheUJ1ZmZlcikge1xuICAgIHZhciB2aWV3Q2xhc3NlcyA9IFtcbiAgICAgICdbb2JqZWN0IEludDhBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgVWludDhBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgVWludDhDbGFtcGVkQXJyYXldJyxcbiAgICAgICdbb2JqZWN0IEludDE2QXJyYXldJyxcbiAgICAgICdbb2JqZWN0IFVpbnQxNkFycmF5XScsXG4gICAgICAnW29iamVjdCBJbnQzMkFycmF5XScsXG4gICAgICAnW29iamVjdCBVaW50MzJBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgRmxvYXQzMkFycmF5XScsXG4gICAgICAnW29iamVjdCBGbG9hdDY0QXJyYXldJ1xuICAgIF1cblxuICAgIHZhciBpc0RhdGFWaWV3ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gb2JqICYmIERhdGFWaWV3LnByb3RvdHlwZS5pc1Byb3RvdHlwZU9mKG9iailcbiAgICB9XG5cbiAgICB2YXIgaXNBcnJheUJ1ZmZlclZpZXcgPSBBcnJheUJ1ZmZlci5pc1ZpZXcgfHwgZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gb2JqICYmIHZpZXdDbGFzc2VzLmluZGV4T2YoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikpID4gLTFcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICBuYW1lID0gU3RyaW5nKG5hbWUpXG4gICAgfVxuICAgIGlmICgvW15hLXowLTlcXC0jJCUmJyorLlxcXl9gfH5dL2kudGVzdChuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBjaGFyYWN0ZXIgaW4gaGVhZGVyIGZpZWxkIG5hbWUnKVxuICAgIH1cbiAgICByZXR1cm4gbmFtZS50b0xvd2VyQ2FzZSgpXG4gIH1cblxuICBmdW5jdGlvbiBub3JtYWxpemVWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICB2YWx1ZSA9IFN0cmluZyh2YWx1ZSlcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvLyBCdWlsZCBhIGRlc3RydWN0aXZlIGl0ZXJhdG9yIGZvciB0aGUgdmFsdWUgbGlzdFxuICBmdW5jdGlvbiBpdGVyYXRvckZvcihpdGVtcykge1xuICAgIHZhciBpdGVyYXRvciA9IHtcbiAgICAgIG5leHQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBpdGVtcy5zaGlmdCgpXG4gICAgICAgIHJldHVybiB7ZG9uZTogdmFsdWUgPT09IHVuZGVmaW5lZCwgdmFsdWU6IHZhbHVlfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzdXBwb3J0Lml0ZXJhYmxlKSB7XG4gICAgICBpdGVyYXRvcltTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBpdGVyYXRvclxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBpdGVyYXRvclxuICB9XG5cbiAgZnVuY3Rpb24gSGVhZGVycyhoZWFkZXJzKSB7XG4gICAgdGhpcy5tYXAgPSB7fVxuXG4gICAgaWYgKGhlYWRlcnMgaW5zdGFuY2VvZiBIZWFkZXJzKSB7XG4gICAgICBoZWFkZXJzLmZvckVhY2goZnVuY3Rpb24odmFsdWUsIG5hbWUpIHtcbiAgICAgICAgdGhpcy5hcHBlbmQobmFtZSwgdmFsdWUpXG4gICAgICB9LCB0aGlzKVxuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShoZWFkZXJzKSkge1xuICAgICAgaGVhZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhlYWRlcikge1xuICAgICAgICB0aGlzLmFwcGVuZChoZWFkZXJbMF0sIGhlYWRlclsxXSlcbiAgICAgIH0sIHRoaXMpXG4gICAgfSBlbHNlIGlmIChoZWFkZXJzKSB7XG4gICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhoZWFkZXJzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgICAgdGhpcy5hcHBlbmQobmFtZSwgaGVhZGVyc1tuYW1lXSlcbiAgICAgIH0sIHRoaXMpXG4gICAgfVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgICBuYW1lID0gbm9ybWFsaXplTmFtZShuYW1lKVxuICAgIHZhbHVlID0gbm9ybWFsaXplVmFsdWUodmFsdWUpXG4gICAgdmFyIG9sZFZhbHVlID0gdGhpcy5tYXBbbmFtZV1cbiAgICB0aGlzLm1hcFtuYW1lXSA9IG9sZFZhbHVlID8gb2xkVmFsdWUrJywnK3ZhbHVlIDogdmFsdWVcbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlWydkZWxldGUnXSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBkZWxldGUgdGhpcy5tYXBbbm9ybWFsaXplTmFtZShuYW1lKV1cbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBuYW1lID0gbm9ybWFsaXplTmFtZShuYW1lKVxuICAgIHJldHVybiB0aGlzLmhhcyhuYW1lKSA/IHRoaXMubWFwW25hbWVdIDogbnVsbFxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuaGFzID0gZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLm1hcC5oYXNPd25Qcm9wZXJ0eShub3JtYWxpemVOYW1lKG5hbWUpKVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgICB0aGlzLm1hcFtub3JtYWxpemVOYW1lKG5hbWUpXSA9IG5vcm1hbGl6ZVZhbHVlKHZhbHVlKVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuZm9yRWFjaCA9IGZ1bmN0aW9uKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgZm9yICh2YXIgbmFtZSBpbiB0aGlzLm1hcCkge1xuICAgICAgaWYgKHRoaXMubWFwLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICAgIGNhbGxiYWNrLmNhbGwodGhpc0FyZywgdGhpcy5tYXBbbmFtZV0sIG5hbWUsIHRoaXMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUua2V5cyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBpdGVtcyA9IFtdXG4gICAgdGhpcy5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlLCBuYW1lKSB7IGl0ZW1zLnB1c2gobmFtZSkgfSlcbiAgICByZXR1cm4gaXRlcmF0b3JGb3IoaXRlbXMpXG4gIH1cblxuICBIZWFkZXJzLnByb3RvdHlwZS52YWx1ZXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgaXRlbXMgPSBbXVxuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSkgeyBpdGVtcy5wdXNoKHZhbHVlKSB9KVxuICAgIHJldHVybiBpdGVyYXRvckZvcihpdGVtcylcbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmVudHJpZXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgaXRlbXMgPSBbXVxuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSwgbmFtZSkgeyBpdGVtcy5wdXNoKFtuYW1lLCB2YWx1ZV0pIH0pXG4gICAgcmV0dXJuIGl0ZXJhdG9yRm9yKGl0ZW1zKVxuICB9XG5cbiAgaWYgKHN1cHBvcnQuaXRlcmFibGUpIHtcbiAgICBIZWFkZXJzLnByb3RvdHlwZVtTeW1ib2wuaXRlcmF0b3JdID0gSGVhZGVycy5wcm90b3R5cGUuZW50cmllc1xuICB9XG5cbiAgZnVuY3Rpb24gY29uc3VtZWQoYm9keSkge1xuICAgIGlmIChib2R5LmJvZHlVc2VkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcignQWxyZWFkeSByZWFkJykpXG4gICAgfVxuICAgIGJvZHkuYm9keVVzZWQgPSB0cnVlXG4gIH1cblxuICBmdW5jdGlvbiBmaWxlUmVhZGVyUmVhZHkocmVhZGVyKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVhZGVyLm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKHJlYWRlci5yZXN1bHQpXG4gICAgICB9XG4gICAgICByZWFkZXIub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QocmVhZGVyLmVycm9yKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBmdW5jdGlvbiByZWFkQmxvYkFzQXJyYXlCdWZmZXIoYmxvYikge1xuICAgIHZhciByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpXG4gICAgdmFyIHByb21pc2UgPSBmaWxlUmVhZGVyUmVhZHkocmVhZGVyKVxuICAgIHJlYWRlci5yZWFkQXNBcnJheUJ1ZmZlcihibG9iKVxuICAgIHJldHVybiBwcm9taXNlXG4gIH1cblxuICBmdW5jdGlvbiByZWFkQmxvYkFzVGV4dChibG9iKSB7XG4gICAgdmFyIHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKClcbiAgICB2YXIgcHJvbWlzZSA9IGZpbGVSZWFkZXJSZWFkeShyZWFkZXIpXG4gICAgcmVhZGVyLnJlYWRBc1RleHQoYmxvYilcbiAgICByZXR1cm4gcHJvbWlzZVxuICB9XG5cbiAgZnVuY3Rpb24gcmVhZEFycmF5QnVmZmVyQXNUZXh0KGJ1Zikge1xuICAgIHZhciB2aWV3ID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIHZhciBjaGFycyA9IG5ldyBBcnJheSh2aWV3Lmxlbmd0aClcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdmlldy5sZW5ndGg7IGkrKykge1xuICAgICAgY2hhcnNbaV0gPSBTdHJpbmcuZnJvbUNoYXJDb2RlKHZpZXdbaV0pXG4gICAgfVxuICAgIHJldHVybiBjaGFycy5qb2luKCcnKVxuICB9XG5cbiAgZnVuY3Rpb24gYnVmZmVyQ2xvbmUoYnVmKSB7XG4gICAgaWYgKGJ1Zi5zbGljZSkge1xuICAgICAgcmV0dXJuIGJ1Zi5zbGljZSgwKVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgdmlldyA9IG5ldyBVaW50OEFycmF5KGJ1Zi5ieXRlTGVuZ3RoKVxuICAgICAgdmlldy5zZXQobmV3IFVpbnQ4QXJyYXkoYnVmKSlcbiAgICAgIHJldHVybiB2aWV3LmJ1ZmZlclxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIEJvZHkoKSB7XG4gICAgdGhpcy5ib2R5VXNlZCA9IGZhbHNlXG5cbiAgICB0aGlzLl9pbml0Qm9keSA9IGZ1bmN0aW9uKGJvZHkpIHtcbiAgICAgIHRoaXMuX2JvZHlJbml0ID0gYm9keVxuICAgICAgaWYgKCFib2R5KSB7XG4gICAgICAgIHRoaXMuX2JvZHlUZXh0ID0gJydcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGJvZHkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRoaXMuX2JvZHlUZXh0ID0gYm9keVxuICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LmJsb2IgJiYgQmxvYi5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICB0aGlzLl9ib2R5QmxvYiA9IGJvZHlcbiAgICAgIH0gZWxzZSBpZiAoc3VwcG9ydC5mb3JtRGF0YSAmJiBGb3JtRGF0YS5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICB0aGlzLl9ib2R5Rm9ybURhdGEgPSBib2R5XG4gICAgICB9IGVsc2UgaWYgKHN1cHBvcnQuc2VhcmNoUGFyYW1zICYmIFVSTFNlYXJjaFBhcmFtcy5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICB0aGlzLl9ib2R5VGV4dCA9IGJvZHkudG9TdHJpbmcoKVxuICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LmFycmF5QnVmZmVyICYmIHN1cHBvcnQuYmxvYiAmJiBpc0RhdGFWaWV3KGJvZHkpKSB7XG4gICAgICAgIHRoaXMuX2JvZHlBcnJheUJ1ZmZlciA9IGJ1ZmZlckNsb25lKGJvZHkuYnVmZmVyKVxuICAgICAgICAvLyBJRSAxMC0xMSBjYW4ndCBoYW5kbGUgYSBEYXRhVmlldyBib2R5LlxuICAgICAgICB0aGlzLl9ib2R5SW5pdCA9IG5ldyBCbG9iKFt0aGlzLl9ib2R5QXJyYXlCdWZmZXJdKVxuICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LmFycmF5QnVmZmVyICYmIChBcnJheUJ1ZmZlci5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSB8fCBpc0FycmF5QnVmZmVyVmlldyhib2R5KSkpIHtcbiAgICAgICAgdGhpcy5fYm9keUFycmF5QnVmZmVyID0gYnVmZmVyQ2xvbmUoYm9keSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcigndW5zdXBwb3J0ZWQgQm9keUluaXQgdHlwZScpXG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBib2R5ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHRoaXMuaGVhZGVycy5zZXQoJ2NvbnRlbnQtdHlwZScsICd0ZXh0L3BsYWluO2NoYXJzZXQ9VVRGLTgnKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlCbG9iICYmIHRoaXMuX2JvZHlCbG9iLnR5cGUpIHtcbiAgICAgICAgICB0aGlzLmhlYWRlcnMuc2V0KCdjb250ZW50LXR5cGUnLCB0aGlzLl9ib2R5QmxvYi50eXBlKVxuICAgICAgICB9IGVsc2UgaWYgKHN1cHBvcnQuc2VhcmNoUGFyYW1zICYmIFVSTFNlYXJjaFBhcmFtcy5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICAgIHRoaXMuaGVhZGVycy5zZXQoJ2NvbnRlbnQtdHlwZScsICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQ7Y2hhcnNldD1VVEYtOCcpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3VwcG9ydC5ibG9iKSB7XG4gICAgICB0aGlzLmJsb2IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHJlamVjdGVkID0gY29uc3VtZWQodGhpcylcbiAgICAgICAgaWYgKHJlamVjdGVkKSB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdGVkXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5fYm9keUJsb2IpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuX2JvZHlCbG9iKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlBcnJheUJ1ZmZlcikge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IEJsb2IoW3RoaXMuX2JvZHlBcnJheUJ1ZmZlcl0pKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlGb3JtRGF0YSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignY291bGQgbm90IHJlYWQgRm9ybURhdGEgYm9keSBhcyBibG9iJylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBCbG9iKFt0aGlzLl9ib2R5VGV4dF0pKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMuYXJyYXlCdWZmZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHRoaXMuX2JvZHlBcnJheUJ1ZmZlcikge1xuICAgICAgICAgIHJldHVybiBjb25zdW1lZCh0aGlzKSB8fCBQcm9taXNlLnJlc29sdmUodGhpcy5fYm9keUFycmF5QnVmZmVyKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB0aGlzLmJsb2IoKS50aGVuKHJlYWRCbG9iQXNBcnJheUJ1ZmZlcilcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMudGV4dCA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHJlamVjdGVkID0gY29uc3VtZWQodGhpcylcbiAgICAgIGlmIChyZWplY3RlZCkge1xuICAgICAgICByZXR1cm4gcmVqZWN0ZWRcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2JvZHlCbG9iKSB7XG4gICAgICAgIHJldHVybiByZWFkQmxvYkFzVGV4dCh0aGlzLl9ib2R5QmxvYilcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fYm9keUFycmF5QnVmZmVyKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVhZEFycmF5QnVmZmVyQXNUZXh0KHRoaXMuX2JvZHlBcnJheUJ1ZmZlcikpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlGb3JtRGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvdWxkIG5vdCByZWFkIEZvcm1EYXRhIGJvZHkgYXMgdGV4dCcpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuX2JvZHlUZXh0KVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzdXBwb3J0LmZvcm1EYXRhKSB7XG4gICAgICB0aGlzLmZvcm1EYXRhID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnRleHQoKS50aGVuKGRlY29kZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmpzb24gPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLnRleHQoKS50aGVuKEpTT04ucGFyc2UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8vIEhUVFAgbWV0aG9kcyB3aG9zZSBjYXBpdGFsaXphdGlvbiBzaG91bGQgYmUgbm9ybWFsaXplZFxuICB2YXIgbWV0aG9kcyA9IFsnREVMRVRFJywgJ0dFVCcsICdIRUFEJywgJ09QVElPTlMnLCAnUE9TVCcsICdQVVQnXVxuXG4gIGZ1bmN0aW9uIG5vcm1hbGl6ZU1ldGhvZChtZXRob2QpIHtcbiAgICB2YXIgdXBjYXNlZCA9IG1ldGhvZC50b1VwcGVyQ2FzZSgpXG4gICAgcmV0dXJuIChtZXRob2RzLmluZGV4T2YodXBjYXNlZCkgPiAtMSkgPyB1cGNhc2VkIDogbWV0aG9kXG4gIH1cblxuICBmdW5jdGlvbiBSZXF1ZXN0KGlucHV0LCBvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge31cbiAgICB2YXIgYm9keSA9IG9wdGlvbnMuYm9keVxuXG4gICAgaWYgKGlucHV0IGluc3RhbmNlb2YgUmVxdWVzdCkge1xuICAgICAgaWYgKGlucHV0LmJvZHlVc2VkKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FscmVhZHkgcmVhZCcpXG4gICAgICB9XG4gICAgICB0aGlzLnVybCA9IGlucHV0LnVybFxuICAgICAgdGhpcy5jcmVkZW50aWFscyA9IGlucHV0LmNyZWRlbnRpYWxzXG4gICAgICBpZiAoIW9wdGlvbnMuaGVhZGVycykge1xuICAgICAgICB0aGlzLmhlYWRlcnMgPSBuZXcgSGVhZGVycyhpbnB1dC5oZWFkZXJzKVxuICAgICAgfVxuICAgICAgdGhpcy5tZXRob2QgPSBpbnB1dC5tZXRob2RcbiAgICAgIHRoaXMubW9kZSA9IGlucHV0Lm1vZGVcbiAgICAgIGlmICghYm9keSAmJiBpbnB1dC5fYm9keUluaXQgIT0gbnVsbCkge1xuICAgICAgICBib2R5ID0gaW5wdXQuX2JvZHlJbml0XG4gICAgICAgIGlucHV0LmJvZHlVc2VkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnVybCA9IFN0cmluZyhpbnB1dClcbiAgICB9XG5cbiAgICB0aGlzLmNyZWRlbnRpYWxzID0gb3B0aW9ucy5jcmVkZW50aWFscyB8fCB0aGlzLmNyZWRlbnRpYWxzIHx8ICdvbWl0J1xuICAgIGlmIChvcHRpb25zLmhlYWRlcnMgfHwgIXRoaXMuaGVhZGVycykge1xuICAgICAgdGhpcy5oZWFkZXJzID0gbmV3IEhlYWRlcnMob3B0aW9ucy5oZWFkZXJzKVxuICAgIH1cbiAgICB0aGlzLm1ldGhvZCA9IG5vcm1hbGl6ZU1ldGhvZChvcHRpb25zLm1ldGhvZCB8fCB0aGlzLm1ldGhvZCB8fCAnR0VUJylcbiAgICB0aGlzLm1vZGUgPSBvcHRpb25zLm1vZGUgfHwgdGhpcy5tb2RlIHx8IG51bGxcbiAgICB0aGlzLnJlZmVycmVyID0gbnVsbFxuXG4gICAgaWYgKCh0aGlzLm1ldGhvZCA9PT0gJ0dFVCcgfHwgdGhpcy5tZXRob2QgPT09ICdIRUFEJykgJiYgYm9keSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQm9keSBub3QgYWxsb3dlZCBmb3IgR0VUIG9yIEhFQUQgcmVxdWVzdHMnKVxuICAgIH1cbiAgICB0aGlzLl9pbml0Qm9keShib2R5KVxuICB9XG5cbiAgUmVxdWVzdC5wcm90b3R5cGUuY2xvbmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3QodGhpcywgeyBib2R5OiB0aGlzLl9ib2R5SW5pdCB9KVxuICB9XG5cbiAgZnVuY3Rpb24gZGVjb2RlKGJvZHkpIHtcbiAgICB2YXIgZm9ybSA9IG5ldyBGb3JtRGF0YSgpXG4gICAgYm9keS50cmltKCkuc3BsaXQoJyYnKS5mb3JFYWNoKGZ1bmN0aW9uKGJ5dGVzKSB7XG4gICAgICBpZiAoYnl0ZXMpIHtcbiAgICAgICAgdmFyIHNwbGl0ID0gYnl0ZXMuc3BsaXQoJz0nKVxuICAgICAgICB2YXIgbmFtZSA9IHNwbGl0LnNoaWZ0KCkucmVwbGFjZSgvXFwrL2csICcgJylcbiAgICAgICAgdmFyIHZhbHVlID0gc3BsaXQuam9pbignPScpLnJlcGxhY2UoL1xcKy9nLCAnICcpXG4gICAgICAgIGZvcm0uYXBwZW5kKGRlY29kZVVSSUNvbXBvbmVudChuYW1lKSwgZGVjb2RlVVJJQ29tcG9uZW50KHZhbHVlKSlcbiAgICAgIH1cbiAgICB9KVxuICAgIHJldHVybiBmb3JtXG4gIH1cblxuICBmdW5jdGlvbiBwYXJzZUhlYWRlcnMocmF3SGVhZGVycykge1xuICAgIHZhciBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKVxuICAgIC8vIFJlcGxhY2UgaW5zdGFuY2VzIG9mIFxcclxcbiBhbmQgXFxuIGZvbGxvd2VkIGJ5IGF0IGxlYXN0IG9uZSBzcGFjZSBvciBob3Jpem9udGFsIHRhYiB3aXRoIGEgc3BhY2VcbiAgICAvLyBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNzIzMCNzZWN0aW9uLTMuMlxuICAgIHZhciBwcmVQcm9jZXNzZWRIZWFkZXJzID0gcmF3SGVhZGVycy5yZXBsYWNlKC9cXHI/XFxuW1xcdCBdKy9nLCAnICcpXG4gICAgcHJlUHJvY2Vzc2VkSGVhZGVycy5zcGxpdCgvXFxyP1xcbi8pLmZvckVhY2goZnVuY3Rpb24obGluZSkge1xuICAgICAgdmFyIHBhcnRzID0gbGluZS5zcGxpdCgnOicpXG4gICAgICB2YXIga2V5ID0gcGFydHMuc2hpZnQoKS50cmltKClcbiAgICAgIGlmIChrZXkpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gcGFydHMuam9pbignOicpLnRyaW0oKVxuICAgICAgICBoZWFkZXJzLmFwcGVuZChrZXksIHZhbHVlKVxuICAgICAgfVxuICAgIH0pXG4gICAgcmV0dXJuIGhlYWRlcnNcbiAgfVxuXG4gIEJvZHkuY2FsbChSZXF1ZXN0LnByb3RvdHlwZSlcblxuICBmdW5jdGlvbiBSZXNwb25zZShib2R5SW5pdCwgb3B0aW9ucykge1xuICAgIGlmICghb3B0aW9ucykge1xuICAgICAgb3B0aW9ucyA9IHt9XG4gICAgfVxuXG4gICAgdGhpcy50eXBlID0gJ2RlZmF1bHQnXG4gICAgdGhpcy5zdGF0dXMgPSBvcHRpb25zLnN0YXR1cyA9PT0gdW5kZWZpbmVkID8gMjAwIDogb3B0aW9ucy5zdGF0dXNcbiAgICB0aGlzLm9rID0gdGhpcy5zdGF0dXMgPj0gMjAwICYmIHRoaXMuc3RhdHVzIDwgMzAwXG4gICAgdGhpcy5zdGF0dXNUZXh0ID0gJ3N0YXR1c1RleHQnIGluIG9wdGlvbnMgPyBvcHRpb25zLnN0YXR1c1RleHQgOiAnT0snXG4gICAgdGhpcy5oZWFkZXJzID0gbmV3IEhlYWRlcnMob3B0aW9ucy5oZWFkZXJzKVxuICAgIHRoaXMudXJsID0gb3B0aW9ucy51cmwgfHwgJydcbiAgICB0aGlzLl9pbml0Qm9keShib2R5SW5pdClcbiAgfVxuXG4gIEJvZHkuY2FsbChSZXNwb25zZS5wcm90b3R5cGUpXG5cbiAgUmVzcG9uc2UucHJvdG90eXBlLmNsb25lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZSh0aGlzLl9ib2R5SW5pdCwge1xuICAgICAgc3RhdHVzOiB0aGlzLnN0YXR1cyxcbiAgICAgIHN0YXR1c1RleHQ6IHRoaXMuc3RhdHVzVGV4dCxcbiAgICAgIGhlYWRlcnM6IG5ldyBIZWFkZXJzKHRoaXMuaGVhZGVycyksXG4gICAgICB1cmw6IHRoaXMudXJsXG4gICAgfSlcbiAgfVxuXG4gIFJlc3BvbnNlLmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKG51bGwsIHtzdGF0dXM6IDAsIHN0YXR1c1RleHQ6ICcnfSlcbiAgICByZXNwb25zZS50eXBlID0gJ2Vycm9yJ1xuICAgIHJldHVybiByZXNwb25zZVxuICB9XG5cbiAgdmFyIHJlZGlyZWN0U3RhdHVzZXMgPSBbMzAxLCAzMDIsIDMwMywgMzA3LCAzMDhdXG5cbiAgUmVzcG9uc2UucmVkaXJlY3QgPSBmdW5jdGlvbih1cmwsIHN0YXR1cykge1xuICAgIGlmIChyZWRpcmVjdFN0YXR1c2VzLmluZGV4T2Yoc3RhdHVzKSA9PT0gLTEpIHtcbiAgICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdJbnZhbGlkIHN0YXR1cyBjb2RlJylcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtzdGF0dXM6IHN0YXR1cywgaGVhZGVyczoge2xvY2F0aW9uOiB1cmx9fSlcbiAgfVxuXG4gIHNlbGYuSGVhZGVycyA9IEhlYWRlcnNcbiAgc2VsZi5SZXF1ZXN0ID0gUmVxdWVzdFxuICBzZWxmLlJlc3BvbnNlID0gUmVzcG9uc2VcblxuICBzZWxmLmZldGNoID0gZnVuY3Rpb24oaW5wdXQsIGluaXQpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICB2YXIgcmVxdWVzdCA9IG5ldyBSZXF1ZXN0KGlucHV0LCBpbml0KVxuICAgICAgdmFyIHhociA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpXG5cbiAgICAgIHhoci5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XG4gICAgICAgICAgc3RhdHVzOiB4aHIuc3RhdHVzLFxuICAgICAgICAgIHN0YXR1c1RleHQ6IHhoci5zdGF0dXNUZXh0LFxuICAgICAgICAgIGhlYWRlcnM6IHBhcnNlSGVhZGVycyh4aHIuZ2V0QWxsUmVzcG9uc2VIZWFkZXJzKCkgfHwgJycpXG4gICAgICAgIH1cbiAgICAgICAgb3B0aW9ucy51cmwgPSAncmVzcG9uc2VVUkwnIGluIHhociA/IHhoci5yZXNwb25zZVVSTCA6IG9wdGlvbnMuaGVhZGVycy5nZXQoJ1gtUmVxdWVzdC1VUkwnKVxuICAgICAgICB2YXIgYm9keSA9ICdyZXNwb25zZScgaW4geGhyID8geGhyLnJlc3BvbnNlIDogeGhyLnJlc3BvbnNlVGV4dFxuICAgICAgICByZXNvbHZlKG5ldyBSZXNwb25zZShib2R5LCBvcHRpb25zKSlcbiAgICAgIH1cblxuICAgICAgeGhyLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KG5ldyBUeXBlRXJyb3IoJ05ldHdvcmsgcmVxdWVzdCBmYWlsZWQnKSlcbiAgICAgIH1cblxuICAgICAgeGhyLm9udGltZW91dCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QobmV3IFR5cGVFcnJvcignTmV0d29yayByZXF1ZXN0IGZhaWxlZCcpKVxuICAgICAgfVxuXG4gICAgICB4aHIub3BlbihyZXF1ZXN0Lm1ldGhvZCwgcmVxdWVzdC51cmwsIHRydWUpXG5cbiAgICAgIGlmIChyZXF1ZXN0LmNyZWRlbnRpYWxzID09PSAnaW5jbHVkZScpIHtcbiAgICAgICAgeGhyLndpdGhDcmVkZW50aWFscyA9IHRydWVcbiAgICAgIH0gZWxzZSBpZiAocmVxdWVzdC5jcmVkZW50aWFscyA9PT0gJ29taXQnKSB7XG4gICAgICAgIHhoci53aXRoQ3JlZGVudGlhbHMgPSBmYWxzZVxuICAgICAgfVxuXG4gICAgICBpZiAoJ3Jlc3BvbnNlVHlwZScgaW4geGhyICYmIHN1cHBvcnQuYmxvYikge1xuICAgICAgICB4aHIucmVzcG9uc2VUeXBlID0gJ2Jsb2InXG4gICAgICB9XG5cbiAgICAgIHJlcXVlc3QuaGVhZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKG5hbWUsIHZhbHVlKVxuICAgICAgfSlcblxuICAgICAgeGhyLnNlbmQodHlwZW9mIHJlcXVlc3QuX2JvZHlJbml0ID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiByZXF1ZXN0Ll9ib2R5SW5pdClcbiAgICB9KVxuICB9XG4gIHNlbGYuZmV0Y2gucG9seWZpbGwgPSB0cnVlXG59KSh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcgPyBzZWxmIDogdGhpcyk7XG4iLCJjb25zdCBzdG9yZSA9ICdkYXJ3aW4tc3RyZWV0LWZvb2QnO1xuY29uc3QgdmVyc2lvbiA9IDE7XG5jb25zdCB2ZW5kb3JTdG9yZU5hbWUgPSAndmVuZG9ycyc7XG5cbmNsYXNzIERCSGFuZGxlciB7XG5cdGNvbnN0cnVjdG9yKCkge1xuXG5cdFx0dGhpcy5wZW5kaW5nQWN0aW9ucyA9IFtdO1xuXHRcdHRoaXMuY29ubmVjdCgpO1xuXG5cdFx0dGhpcy5zYXZlRGF0YSA9IHRoaXMuc2F2ZURhdGEuYmluZCh0aGlzKTtcblx0XHR0aGlzLmdldEFsbERhdGEgPSB0aGlzLmdldEFsbERhdGEuYmluZCh0aGlzKTtcblx0XHR0aGlzLl9nZXRBbGxEYXRhRm9yUHJvbWlzZSA9IHRoaXMuX2dldEFsbERhdGFGb3JQcm9taXNlLmJpbmQodGhpcyk7XG5cdH1cblxuXHRlcnJvckhhbmRsZXIoZXZ0KSB7XG5cdFx0Y29uc29sZS5lcnJvcignREIgRXJyb3InLCBldnQudGFyZ2V0LmVycm9yKTtcblx0fVxuXG5cdHVwZ3JhZGVEQihldnQpIHtcblx0XHRjb25zdCBkYiA9IGV2dC50YXJnZXQucmVzdWx0O1xuXG5cdFx0aWYoZXZ0Lm9sZFZlcnNpb24gPCAxKSB7XG5cdFx0XHRjb25zdCB2ZW5kb3JTdG9yZSA9IGRiLmNyZWF0ZU9iamVjdFN0b3JlKHZlbmRvclN0b3JlTmFtZSwge2tleVBhdGg6ICdpZCd9KTtcblx0XHRcdHZlbmRvclN0b3JlLmNyZWF0ZUluZGV4KCduYW1lJywgJ25hbWUnLCB7dW5pcXVlOiB0cnVlfSk7XG5cdFx0fVxuXHR9XG5cblx0Y29ubmVjdCgpIHtcblx0XHRjb25zdCBjb25uUmVxdWVzdCA9IGluZGV4ZWREQi5vcGVuKHN0b3JlLCB2ZXJzaW9uKTtcblxuXHRcdGNvbm5SZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ3N1Y2Nlc3MnLCAoZXZ0KSA9PiB7XG5cdFx0XHR0aGlzLmRiID0gZXZ0LnRhcmdldC5yZXN1bHQ7XG5cdFx0XHR0aGlzLmRiLmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgdGhpcy5lcnJvckhhbmRsZXIpO1xuXG5cdFx0XHRpZih0aGlzLnBlbmRpbmdBY3Rpb25zKSB7XG5cdFx0XHRcdHdoaWxlKHRoaXMucGVuZGluZ0FjdGlvbnMubGVuZ3RoIDwgMCkge1xuXHRcdFx0XHRcdHRoaXMucGVuZGluZ0FjdGlvbnMucG9wKCkoKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0pO1xuXG5cdFx0Y29ublJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcigndXBncmFkZW5lZWRlZCcsIHRoaXMudXBncmFkZURCKTtcblxuXHRcdGNvbm5SZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgdGhpcy5lcnJvckhhbmRsZXIpO1xuXHR9XG5cblx0c2F2ZURhdGEoZGF0YSkge1xuXHRcdGlmKCF0aGlzLmRiKSB7XG5cdFx0XHR0aGlzLnBlbmRpbmdBY3Rpb25zLnB1c2goKCkgPT4gdGhpcy5zYXZlRGF0YShkYXRhKSk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0Y29uc3QgZGF0YUFyciA9IEFycmF5LmlzQXJyYXkoZGF0YSlcblx0XHRcdD8gZGF0YVxuXHRcdFx0OiBbZGF0YV07XG5cblx0XHRjb25zdCB0cmFuc2FjdGlvbiA9IHRoaXMuZGIudHJhbnNhY3Rpb24odmVuZG9yU3RvcmVOYW1lLCAncmVhZHdyaXRlJyk7XG5cdFx0dmFyIHZlbmRvclN0b3JlID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUodmVuZG9yU3RvcmVOYW1lKTtcblxuXHRcdGRhdGFBcnIuZm9yRWFjaCgodmVuZG9yRGF0YSkgPT4gdmVuZG9yU3RvcmVcblx0XHRcdC5nZXQodmVuZG9yRGF0YS5pZClcblx0XHRcdC5vbnN1Y2Nlc3MgPSAoZXZ0KSA9PiB7XG5cdFx0XHRcdGlmKGV2dC50YXJnZXQucmVzdWx0KSB7XG5cdFx0XHRcdFx0aWYoSlNPTi5zdHJpbmdpZnkoZXZ0LnRhcmdldC5yZXN1bHQpICE9PSBKU09OLnN0cmluZ2lmeSh2ZW5kb3JEYXRhKSkge1xuXHRcdFx0XHRcdFx0dmVuZG9yU3RvcmUucHV0KHZlbmRvckRhdGEpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHR2ZW5kb3JTdG9yZS5hZGQodmVuZG9yRGF0YSk7XG5cdFx0XHRcdH1cblx0XHRcdH0pO1xuXG5cdH1cblxuXHRfZ2V0QWxsRGF0YUZvclByb21pc2UocmVzb2x2ZSwgcmVqZWN0KSB7XG5cdFx0aWYoIXRoaXMuZGIpIHtcblx0XHRcdHRoaXMucGVuZGluZ0FjdGlvbnMucHVzaCgoKSA9PiB0aGlzLl9nZXRBbGxEYXRhRm9yUHJvbWlzZShyZXNvbHZlLCByZWplY3QpKTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Y29uc3QgdmVuZG9yRGF0YSA9IFtdO1xuXHRcdGNvbnN0IHZlbmRvclN0b3JlID0gdGhpcy5kYi50cmFuc2FjdGlvbih2ZW5kb3JTdG9yZU5hbWUpLm9iamVjdFN0b3JlKHZlbmRvclN0b3JlTmFtZSk7XG5cdFx0Y29uc3QgY3Vyc29yID0gdmVuZG9yU3RvcmUub3BlbkN1cnNvcigpO1xuXHRcdFxuXHRcdGN1cnNvci5vbnN1Y2Nlc3MgPSAoZXZ0KSA9PiB7XG5cdFx0XHRjb25zdCBjdXJzb3IgPSBldnQudGFyZ2V0LnJlc3VsdDtcblx0XHRcdGlmKGN1cnNvcikge1xuXHRcdFx0XHR2ZW5kb3JEYXRhLnB1c2goY3Vyc29yLnZhbHVlKTtcblx0XHRcdFx0cmV0dXJuIGN1cnNvci5jb250aW51ZSgpO1xuXHRcdFx0fVxuXHRcdFx0cmVzb2x2ZSh2ZW5kb3JEYXRhKTtcblx0XHR9O1xuXG5cdFx0Y3Vyc29yLm9uZXJyb3IgPSAoZXZ0KSA9PiByZWplY3QoZXZ0LnRhcmdldC5lcnJvcik7XG5cdH1cblxuXHRnZXRBbGxEYXRhKCkge1xuXHRcdHJldHVybiBuZXcgUHJvbWlzZSh0aGlzLl9nZXRBbGxEYXRhRm9yUHJvbWlzZSk7XG5cdH1cblxuXG59XG5cbmV4cG9ydCBkZWZhdWx0IERCSGFuZGxlcjtcbiIsImltcG9ydCBlanMgZnJvbSAnZWpzJztcbmltcG9ydCB0aW1lQ29udmVydCBmcm9tICcuL3RpbWUtY29udmVydCc7XG5cbmNvbnN0IGRheXMgPSBbJ1N1bmRheScsICdNb25kYXknLCAnVHVlc2RheScsICdXZWRuZXNkYXknLCAnVGh1cnNkYXknLCAnRnJpZGF5JywgJ1NhdHVyZGF5J107XG5sZXQgdGVtcGxhdGVTdHJpbmcgPSB1bmRlZmluZWQ7XG5sZXQgdGVtcGxhdGUgPSB1bmRlZmluZWQ7XG5sZXQgdGFyZ2V0ID0gdW5kZWZpbmVkO1xuXG5jb25zdCBnZXRUYXJnZXQgPSAoKSA9PiB7XG5cdGlmKCF0YXJnZXQpIHtcblx0XHR0YXJnZXQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCdtYWluJyk7XG5cdH1cblx0cmV0dXJuIHRhcmdldDtcbn07XG5cbmNvbnN0IHJlbmRlckRheSA9IChkYXRhKSA9PiB7XG5cdGlmKCF0ZW1wbGF0ZSkge1xuXHRcdHRlbXBsYXRlU3RyaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RheVRlbXBsYXRlJykuaW5uZXJIVE1MO1xuXHRcdHRlbXBsYXRlID0gZWpzLmNvbXBpbGUodGVtcGxhdGVTdHJpbmcpO1xuXHR9XG5cblx0cmV0dXJuIHRlbXBsYXRlKGRhdGEpO1xufTtcblxuZnVuY3Rpb24gZHJhd0RheShkYXksIHZlbmRvcnMpIHtcblx0dmFyIG9wZW4gPSBbXTtcblxuXHR2ZW5kb3JzLmZvckVhY2goKHZlbmRvcikgPT4ge1xuXHRcdHZhciBvcGVuSW5kZXggPSB2ZW5kb3IubG9jYXRpb25zLmZpbmRJbmRleChcblx0XHRcdChsb2NhdGlvbikgPT4gbG9jYXRpb24uZGF5c1tkYXldLm9wZW5cblx0XHQpO1xuXG5cdFx0aWYob3BlbkluZGV4ID49IDApIHtcblx0XHRcdHZhciBvcGVuTG9jYXRpb24gPSB2ZW5kb3IubG9jYXRpb25zW29wZW5JbmRleF07XG5cdFx0XHR2YXIgb3BlbkRheSA9IG9wZW5Mb2NhdGlvbi5kYXlzW2RheV07XG5cblx0XHRcdG9wZW4ucHVzaChPYmplY3QuYXNzaWduKFxuXHRcdFx0XHR7fSxcblx0XHRcdFx0dmVuZG9yLFxuXHRcdFx0XHR7XG5cdFx0XHRcdFx0b3BlbkxvY2F0aW9uLFxuXHRcdFx0XHRcdG9wZW5EYXk6IHtcblx0XHRcdFx0XHRcdGRheTogb3BlbkRheS5kYXksXG5cdFx0XHRcdFx0XHRzdGFydDogdGltZUNvbnZlcnQob3BlbkRheS5zdGFydCksXG5cdFx0XHRcdFx0XHRlbmQ6IHRpbWVDb252ZXJ0KG9wZW5EYXkuZW5kKVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0KSk7XG5cdFx0fVxuXG5cdH0pO1xuXG5cdGNvbnN0IGNvbnRlbnQgPSByZW5kZXJEYXkoe1xuXHRcdGRheTogZGF5c1tkYXldLFxuXHRcdGRheUluZGV4OiBkYXksXG5cdFx0dmVuZG9yczogb3BlblxuXHR9KTtcblxuXHRnZXRUYXJnZXQoKS5pbm5lckhUTUwgKz0gY29udGVudDtcbn1cblxuZnVuY3Rpb24gZHJhd0RheXMoZGF5RGF0YSkge1xuXHRnZXRUYXJnZXQoKS5pbm5lckhUTUwgPSBudWxsO1xuXG5cdHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuXHR2YXIgdG9kYXkgPSBub3cuZ2V0RGF5KCk7XG5cblx0ZHJhd0RheSh0b2RheSwgZGF5RGF0YSk7XG5cblxufVxuXG5leHBvcnQgZGVmYXVsdCBkcmF3RGF5cztcbiIsIlxuY29uc3QgdXJsID0gJ2RhdGEuanNvbic7XG5cbmZ1bmN0aW9uIGxvYWRMaXN0KCkge1xuXHRyZXR1cm4gZmV0Y2godXJsKVxuXHRcdC50aGVuKChyZXNwb25zZSkgPT4gcmVzcG9uc2UuanNvbigpKVxuXHRcdC50aGVuKChkYXRhKSA9PiBkYXRhLmZlYXR1cmVzXG5cdFx0XHRcdD8gZGF0YS5mZWF0dXJlcy5tYXAoKGZlYXR1cmUpID0+IGZlYXR1cmUucHJvcGVydGllcylcblx0XHRcdFx0OiB1bmRlZmluZWRcblx0XHQpO1xuXG59O1xuXG5leHBvcnQgZGVmYXVsdCBsb2FkTGlzdDtcbiIsImltcG9ydCAnd2hhdHdnLWZldGNoJztcbmltcG9ydCBsb2FkTGlzdCBmcm9tICcuL2xvYWQtbGlzdCc7XG5pbXBvcnQgdGlkeUxpc3QgZnJvbSAnLi90aWR5LWxpc3QnO1xuaW1wb3J0IGRyYXdEYXlzIGZyb20gJy4vZHJhdy1kYXlzJztcbmltcG9ydCBEQkhhbmRsZXIgZnJvbSAnLi9kYi1oYW5kbGVyJztcblxuY29uc3QgZGJIYW5kbGVyID0gbmV3IERCSGFuZGxlcigpO1xuXG5kYkhhbmRsZXIuZ2V0QWxsRGF0YSgpXG5cdC50aGVuKGRyYXdEYXlzKTtcblxuY29uc3QgZmV0Y2hWZW5kb3JzID0gbG9hZExpc3QoKVxuXHQudGhlbih0aWR5TGlzdCk7XG5cbmZldGNoVmVuZG9ycy50aGVuKGRyYXdEYXlzKTtcbmZldGNoVmVuZG9ycy50aGVuKGRiSGFuZGxlci5zYXZlRGF0YSk7XG5cbmlmICgnc2VydmljZVdvcmtlcicgaW4gbmF2aWdhdG9yKSB7XG5cdHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgKCkgPT4gbmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIucmVnaXN0ZXIoJ3N3LmpzJylcblx0XHQuY2F0Y2goKGVycikgPT4gY29uc29sZS5lcnJvcignU2VydmljZVdvcmtlciByZWdpc3RyYXRpb24gZmFpbGVkOiAnLCBlcnIpKVxuXHQpO1xufVxuIiwiXG5jb25zdCBkYXlzID0ge1xuXHQnU3VuZGF5JzogJ1N1bicsXG5cdCdNb25kYXknOiAnTW9uJyxcblx0J1R1ZXNkYXknOiAnVHVlcycsXG5cdCdXZWRuZXNkYXknOiAnV2VkJyxcblx0J1RodXJzZGF5JzogJ1RodXJzJyxcblx0J0ZyaWRheSc6ICdGcmknLFxuXHQnU2F0dXJkYXknOiAnU2F0J1xufTtcblxuXG5mdW5jdGlvbiB0aWR5TGlzdChsaXN0RGF0YSkge1xuXHRyZXR1cm4gbGlzdERhdGEuZmlsdGVyKChyZWNvcmQsIGluZGV4KSA9PiBsaXN0RGF0YS5maW5kSW5kZXgoKGZpbmRSZWNvcmQpID0+IGZpbmRSZWNvcmQuTmFtZSA9PT0gcmVjb3JkLk5hbWUpID09PSBpbmRleClcblx0XHQubWFwKChyZWNvcmQpID0+ICh7XG5cdFx0XHRpZDogcmVjb3JkLk9CSkVDVElELFxuXHRcdFx0bmFtZTogcmVjb3JkLk5hbWUsXG5cdFx0XHR3ZWJzaXRlOiByZWNvcmQuV2Vic2l0ZSxcblx0XHRcdHR5cGU6IHJlY29yZC5UeXBlLFxuXHRcdFx0bG9jYXRpb25zOiBsaXN0RGF0YS5maWx0ZXIoKGxvY2F0aW9uUmVjb3JkKSA9PiBsb2NhdGlvblJlY29yZC5OYW1lID09PSByZWNvcmQuTmFtZSlcblx0XHRcdFx0Lm1hcCgobG9jYXRpb25SZWNvcmQpID0+ICh7XG5cdFx0XHRcdFx0bmFtZTogbG9jYXRpb25SZWNvcmQuTG9jYXRpb24sXG5cdFx0XHRcdFx0b3BlblRpbWVzOiBsb2NhdGlvblJlY29yZC5PcGVuX1RpbWVzX0Rlc2NyaXB0aW9uLFxuXHRcdFx0XHRcdGRheXM6IE9iamVjdC5rZXlzKGRheXMpXG5cdFx0XHRcdFx0XHQubWFwKChkYXkpID0+ICh7XG5cdFx0XHRcdFx0XHRcdGRheSxcblx0XHRcdFx0XHRcdFx0b3BlbjogcmVjb3JkW2RheV0gPT09ICdZZXMnLFxuXHRcdFx0XHRcdFx0XHRzdGFydDogcmVjb3JkW2Ake2RheXNbZGF5XX1fU3RhcnRgXSxcblx0XHRcdFx0XHRcdFx0ZW5kOiByZWNvcmRbYCR7ZGF5c1tkYXldfV9FbmRgXVxuXHRcdFx0XHRcdFx0fSkpXG5cdFx0XHRcdH0pKVxuXHRcdH0pKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgdGlkeUxpc3Q7XG4iLCJcbi8qKlxuKiBDb252ZXJ0IGEgMjQgaG91ciB0aW1lIHRvIDEyIGhvdXJcbiogZnJvbSBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8xMzg5ODQyMy9qYXZhc2NyaXB0LWNvbnZlcnQtMjQtaG91ci10aW1lLW9mLWRheS1zdHJpbmctdG8tMTItaG91ci10aW1lLXdpdGgtYW0tcG0tYW5kLW5vXG4qIEBwYXJhbSB7c3RyaW5nfSB0aW1lIEEgMjQgaG91ciB0aW1lIHN0cmluZ1xuKiBAcmV0dXJuIHtzdHJpbmd9IEEgZm9ybWF0dGVkIDEyIGhvdXIgdGltZSBzdHJpbmdcbioqL1xuZnVuY3Rpb24gdENvbnZlcnQgKHRpbWUpIHtcblx0Ly8gQ2hlY2sgY29ycmVjdCB0aW1lIGZvcm1hdCBhbmQgc3BsaXQgaW50byBjb21wb25lbnRzXG5cdHRpbWUgPSB0aW1lLnRvU3RyaW5nICgpLm1hdGNoICgvXihbMDFdXFxkfDJbMC0zXSkoWzAtNV1cXGQpJC8pIHx8IFt0aW1lXTtcblxuXHRpZiAodGltZS5sZW5ndGggPiAxKSB7IC8vIElmIHRpbWUgZm9ybWF0IGNvcnJlY3Rcblx0XHRjb25zdCBzdWZmaXggPSB0aW1lWzFdIDwgMTIgPyAnQU0nIDogJ1BNJzsgLy8gU2V0IEFNL1BNXG5cdFx0Y29uc3QgaG91cnMgPSB0aW1lWzFdICUgMTIgfHwgMTI7IC8vIEFkanVzdCBob3Vyc1xuXHRcdGNvbnN0IG1pbnV0ZXMgPSB0aW1lWzJdO1xuXG5cdFx0cmV0dXJuIGAke2hvdXJzfToke21pbnV0ZXN9JHtzdWZmaXh9YDtcblx0fVxuXHRyZXR1cm4gdGltZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgdENvbnZlcnQ7XG4iXX0=
