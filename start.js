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
var data = undefined;

var setData = function setData(dayData) {
	return data = dayData;
};
var getData = function getData() {
	return data;
};

var getTarget = function getTarget() {
	if (!target) {
		target = document.querySelector('.day__container');
	}
	return target;
};

var renderDay = function renderDay(data) {
	if (!template) {
		templateString = document.getElementById('dayTemplate').innerHTML;
		template = _ejs2.default.compile(templateString);
	}

	var html = template(data);
	var templateElem = document.createElement('template');
	templateElem.innerHTML = html.trim();
	return templateElem.content.firstChild;
};

function drawDay(day, vendors, classes) {
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
					day: day,
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

	var next = content.querySelector('.day__next-btn');
	next.addEventListener('click', nextDay);
	var prev = content.querySelector('.day__prev-btn');
	prev.addEventListener('click', prevDay);

	if (classes) {
		var classArr = Array.isArray(classes) ? classes : [classes];
		classArr.forEach(function (className) {
			content.classList.add(className);
		});
	}

	return content;
}

function drawDays(dayData) {
	setData(dayData);
	getTarget().innerHTML = null;

	var now = new Date();
	var today = now.getDay();
	var yesterday = today > 0 ? today - 1 : 6;
	var tomorrow = today < 6 ? today + 1 : 0;

	getTarget().appendChild(drawDay(yesterday, dayData));
	getTarget().appendChild(drawDay(today, dayData));
	getTarget().appendChild(drawDay(tomorrow, dayData));
}

function nextDay() {
	var target = getTarget();
	var days = target.childNodes;
	var lastDay = days[days.length - 1];
	var dayIndex = parseInt(lastDay.dataset.day);
	var nextDay = dayIndex < 6 ? dayIndex + 1 : 0;
	var day = drawDay(nextDay, getData());
	var listen = function listen(evt) {
		target.classList.remove('day--next');
		target.removeEventListener('transitionend', listen);
		target.removeChild(days[0]);
		target.appendChild(day);
	};

	target.addEventListener('transitionend', listen);
	target.classList.add('day--next');
}

function prevDay() {
	var target = getTarget();
	var days = target.childNodes;
	var firstDay = days[0];
	var dayIndex = parseInt(firstDay.dataset.day);
	var nextDay = dayIndex > 0 ? dayIndex - 1 : 6;
	var day = drawDay(nextDay, getData());
	var listen = function listen() {
		target.classList.remove('day--previous');
		target.removeEventListener('transitionend', listen);
		target.removeChild(days[days.length - 1]);
		target.prepend(day);
	};

	target.addEventListener('transitionend', listen);
	target.classList.add('day--previous');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9saWIvX2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL2Vqcy9saWIvZWpzLmpzIiwibm9kZV9tb2R1bGVzL2Vqcy9saWIvdXRpbHMuanMiLCJub2RlX21vZHVsZXMvZWpzL3BhY2thZ2UuanNvbiIsIm5vZGVfbW9kdWxlcy9wYXRoLWJyb3dzZXJpZnkvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3doYXR3Zy1mZXRjaC9mZXRjaC5qcyIsInNyYy9qcy9kYi1oYW5kbGVyLmpzIiwic3JjL2pzL2RyYXctZGF5cy5qcyIsInNyYy9qcy9sb2FkLWxpc3QuanMiLCJzcmMvanMvc3RhcnQuanMiLCJzcmMvanMvdGlkeS1saXN0LmpzIiwic3JjL2pzL3RpbWUtY29udmVydC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzM2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2hGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7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d0IsT0FBTyxJQUFuRDtBQUFBLElBQWhCLEVBQ1QsR0FEUyxDQUNMLFVBQUMsY0FBRDtBQUFBLFdBQXFCO0FBQ3pCLFdBQU0sZUFBZSxRQURJO0FBRXpCLGdCQUFXLGVBQWUsc0JBRkQ7QUFHekIsV0FBTSxPQUFPLElBQVAsQ0FBWSxJQUFaLEVBQ0osR0FESSxDQUNBLFVBQUMsR0FBRDtBQUFBLGFBQVU7QUFDZCxlQURjO0FBRWQsYUFBTSxPQUFPLEdBQVAsTUFBZ0IsS0FGUjtBQUdkLGNBQU8sT0FBVSxLQUFLLEdBQUwsQ0FBVixZQUhPO0FBSWQsWUFBSyxPQUFVLEtBQUssR0FBTCxDQUFWO0FBSlMsT0FBVjtBQUFBLE1BREE7QUFIbUIsS0FBckI7QUFBQSxJQURLO0FBTE0sR0FBYjtBQUFBLEVBREMsQ0FBUDtBQW1CQTs7a0JBRWMsUTs7Ozs7Ozs7O0FDakNmOzs7Ozs7QUFNQSxTQUFTLFFBQVQsQ0FBbUIsSUFBbkIsRUFBeUI7QUFDeEI7QUFDQSxRQUFPLEtBQUssUUFBTCxHQUFpQixLQUFqQixDQUF3Qiw0QkFBeEIsS0FBeUQsQ0FBQyxJQUFELENBQWhFOztBQUVBLEtBQUksS0FBSyxNQUFMLEdBQWMsQ0FBbEIsRUFBcUI7QUFBRTtBQUN0QixNQUFNLFNBQVMsS0FBSyxDQUFMLElBQVUsRUFBVixHQUFlLElBQWYsR0FBc0IsSUFBckMsQ0FEb0IsQ0FDdUI7QUFDM0MsTUFBTSxRQUFRLEtBQUssQ0FBTCxJQUFVLEVBQVYsSUFBZ0IsRUFBOUIsQ0FGb0IsQ0FFYztBQUNsQyxNQUFNLFVBQVUsS0FBSyxDQUFMLENBQWhCOztBQUVBLFNBQVUsS0FBVixTQUFtQixPQUFuQixHQUE2QixNQUE3QjtBQUNBO0FBQ0QsUUFBTyxJQUFQO0FBQ0E7O2tCQUVjLFEiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIiLCIvKlxuICogRUpTIEVtYmVkZGVkIEphdmFTY3JpcHQgdGVtcGxhdGVzXG4gKiBDb3B5cmlnaHQgMjExMiBNYXR0aGV3IEVlcm5pc3NlIChtZGVAZmxlZWdpeC5vcmcpXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4qL1xuXG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogQGZpbGUgRW1iZWRkZWQgSmF2YVNjcmlwdCB0ZW1wbGF0aW5nIGVuZ2luZS4ge0BsaW5rIGh0dHA6Ly9lanMuY299XG4gKiBAYXV0aG9yIE1hdHRoZXcgRWVybmlzc2UgPG1kZUBmbGVlZ2l4Lm9yZz5cbiAqIEBhdXRob3IgVGlhbmNoZW5nIFwiVGltb3RoeVwiIEd1IDx0aW1vdGh5Z3U5OUBnbWFpbC5jb20+XG4gKiBAcHJvamVjdCBFSlNcbiAqIEBsaWNlbnNlIHtAbGluayBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjAgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wfVxuICovXG5cbi8qKlxuICogRUpTIGludGVybmFsIGZ1bmN0aW9ucy5cbiAqXG4gKiBUZWNobmljYWxseSB0aGlzIFwibW9kdWxlXCIgbGllcyBpbiB0aGUgc2FtZSBmaWxlIGFzIHtAbGluayBtb2R1bGU6ZWpzfSwgZm9yXG4gKiB0aGUgc2FrZSBvZiBvcmdhbml6YXRpb24gYWxsIHRoZSBwcml2YXRlIGZ1bmN0aW9ucyByZSBncm91cGVkIGludG8gdGhpc1xuICogbW9kdWxlLlxuICpcbiAqIEBtb2R1bGUgZWpzLWludGVybmFsXG4gKiBAcHJpdmF0ZVxuICovXG5cbi8qKlxuICogRW1iZWRkZWQgSmF2YVNjcmlwdCB0ZW1wbGF0aW5nIGVuZ2luZS5cbiAqXG4gKiBAbW9kdWxlIGVqc1xuICogQHB1YmxpY1xuICovXG5cbnZhciBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG52YXIgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcblxudmFyIHNjb3BlT3B0aW9uV2FybmVkID0gZmFsc2U7XG52YXIgX1ZFUlNJT05fU1RSSU5HID0gcmVxdWlyZSgnLi4vcGFja2FnZS5qc29uJykudmVyc2lvbjtcbnZhciBfREVGQVVMVF9ERUxJTUlURVIgPSAnJSc7XG52YXIgX0RFRkFVTFRfTE9DQUxTX05BTUUgPSAnbG9jYWxzJztcbnZhciBfTkFNRSA9ICdlanMnO1xudmFyIF9SRUdFWF9TVFJJTkcgPSAnKDwlJXwlJT58PCU9fDwlLXw8JV98PCUjfDwlfCU+fC0lPnxfJT4pJztcbnZhciBfT1BUU19QQVNTQUJMRV9XSVRIX0RBVEEgPSBbJ2RlbGltaXRlcicsICdzY29wZScsICdjb250ZXh0JywgJ2RlYnVnJywgJ2NvbXBpbGVEZWJ1ZycsXG4gICdjbGllbnQnLCAnX3dpdGgnLCAncm1XaGl0ZXNwYWNlJywgJ3N0cmljdCcsICdmaWxlbmFtZScsICdhc3luYyddO1xuLy8gV2UgZG9uJ3QgYWxsb3cgJ2NhY2hlJyBvcHRpb24gdG8gYmUgcGFzc2VkIGluIHRoZSBkYXRhIG9iaiBmb3Jcbi8vIHRoZSBub3JtYWwgYHJlbmRlcmAgY2FsbCwgYnV0IHRoaXMgaXMgd2hlcmUgRXhwcmVzcyAyICYgMyBwdXQgaXRcbi8vIHNvIHdlIG1ha2UgYW4gZXhjZXB0aW9uIGZvciBgcmVuZGVyRmlsZWBcbnZhciBfT1BUU19QQVNTQUJMRV9XSVRIX0RBVEFfRVhQUkVTUyA9IF9PUFRTX1BBU1NBQkxFX1dJVEhfREFUQS5jb25jYXQoJ2NhY2hlJyk7XG52YXIgX0JPTSA9IC9eXFx1RkVGRi87XG5cbi8qKlxuICogRUpTIHRlbXBsYXRlIGZ1bmN0aW9uIGNhY2hlLiBUaGlzIGNhbiBiZSBhIExSVSBvYmplY3QgZnJvbSBscnUtY2FjaGUgTlBNXG4gKiBtb2R1bGUuIEJ5IGRlZmF1bHQsIGl0IGlzIHtAbGluayBtb2R1bGU6dXRpbHMuY2FjaGV9LCBhIHNpbXBsZSBpbi1wcm9jZXNzXG4gKiBjYWNoZSB0aGF0IGdyb3dzIGNvbnRpbnVvdXNseS5cbiAqXG4gKiBAdHlwZSB7Q2FjaGV9XG4gKi9cblxuZXhwb3J0cy5jYWNoZSA9IHV0aWxzLmNhY2hlO1xuXG4vKipcbiAqIEN1c3RvbSBmaWxlIGxvYWRlci4gVXNlZnVsIGZvciB0ZW1wbGF0ZSBwcmVwcm9jZXNzaW5nIG9yIHJlc3RyaWN0aW5nIGFjY2Vzc1xuICogdG8gYSBjZXJ0YWluIHBhcnQgb2YgdGhlIGZpbGVzeXN0ZW0uXG4gKlxuICogQHR5cGUge2ZpbGVMb2FkZXJ9XG4gKi9cblxuZXhwb3J0cy5maWxlTG9hZGVyID0gZnMucmVhZEZpbGVTeW5jO1xuXG4vKipcbiAqIE5hbWUgb2YgdGhlIG9iamVjdCBjb250YWluaW5nIHRoZSBsb2NhbHMuXG4gKlxuICogVGhpcyB2YXJpYWJsZSBpcyBvdmVycmlkZGVuIGJ5IHtAbGluayBPcHRpb25zfWAubG9jYWxzTmFtZWAgaWYgaXQgaXMgbm90XG4gKiBgdW5kZWZpbmVkYC5cbiAqXG4gKiBAdHlwZSB7U3RyaW5nfVxuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMubG9jYWxzTmFtZSA9IF9ERUZBVUxUX0xPQ0FMU19OQU1FO1xuXG4vKipcbiAqIFByb21pc2UgaW1wbGVtZW50YXRpb24gLS0gZGVmYXVsdHMgdG8gdGhlIG5hdGl2ZSBpbXBsZW1lbnRhdGlvbiBpZiBhdmFpbGFibGVcbiAqIFRoaXMgaXMgbW9zdGx5IGp1c3QgZm9yIHRlc3RhYmlsaXR5XG4gKlxuICogQHR5cGUge0Z1bmN0aW9ufVxuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMucHJvbWlzZUltcGwgPSAobmV3IEZ1bmN0aW9uKCdyZXR1cm4gdGhpczsnKSkoKS5Qcm9taXNlO1xuXG4vKipcbiAqIEdldCB0aGUgcGF0aCB0byB0aGUgaW5jbHVkZWQgZmlsZSBmcm9tIHRoZSBwYXJlbnQgZmlsZSBwYXRoIGFuZCB0aGVcbiAqIHNwZWNpZmllZCBwYXRoLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSAgbmFtZSAgICAgc3BlY2lmaWVkIHBhdGhcbiAqIEBwYXJhbSB7U3RyaW5nfSAgZmlsZW5hbWUgcGFyZW50IGZpbGUgcGF0aFxuICogQHBhcmFtIHtCb29sZWFufSBpc0RpciAgICBwYXJlbnQgZmlsZSBwYXRoIHdoZXRoZXIgaXMgZGlyZWN0b3J5XG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKi9cbmV4cG9ydHMucmVzb2x2ZUluY2x1ZGUgPSBmdW5jdGlvbihuYW1lLCBmaWxlbmFtZSwgaXNEaXIpIHtcbiAgdmFyIGRpcm5hbWUgPSBwYXRoLmRpcm5hbWU7XG4gIHZhciBleHRuYW1lID0gcGF0aC5leHRuYW1lO1xuICB2YXIgcmVzb2x2ZSA9IHBhdGgucmVzb2x2ZTtcbiAgdmFyIGluY2x1ZGVQYXRoID0gcmVzb2x2ZShpc0RpciA/IGZpbGVuYW1lIDogZGlybmFtZShmaWxlbmFtZSksIG5hbWUpO1xuICB2YXIgZXh0ID0gZXh0bmFtZShuYW1lKTtcbiAgaWYgKCFleHQpIHtcbiAgICBpbmNsdWRlUGF0aCArPSAnLmVqcyc7XG4gIH1cbiAgcmV0dXJuIGluY2x1ZGVQYXRoO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIHBhdGggdG8gdGhlIGluY2x1ZGVkIGZpbGUgYnkgT3B0aW9uc1xuICpcbiAqIEBwYXJhbSAge1N0cmluZ30gIHBhdGggICAgc3BlY2lmaWVkIHBhdGhcbiAqIEBwYXJhbSAge09wdGlvbnN9IG9wdGlvbnMgY29tcGlsYXRpb24gb3B0aW9uc1xuICogQHJldHVybiB7U3RyaW5nfVxuICovXG5mdW5jdGlvbiBnZXRJbmNsdWRlUGF0aChwYXRoLCBvcHRpb25zKSB7XG4gIHZhciBpbmNsdWRlUGF0aDtcbiAgdmFyIGZpbGVQYXRoO1xuICB2YXIgdmlld3MgPSBvcHRpb25zLnZpZXdzO1xuXG4gIC8vIEFicyBwYXRoXG4gIGlmIChwYXRoLmNoYXJBdCgwKSA9PSAnLycpIHtcbiAgICBpbmNsdWRlUGF0aCA9IGV4cG9ydHMucmVzb2x2ZUluY2x1ZGUocGF0aC5yZXBsYWNlKC9eXFwvKi8sJycpLCBvcHRpb25zLnJvb3QgfHwgJy8nLCB0cnVlKTtcbiAgfVxuICAvLyBSZWxhdGl2ZSBwYXRoc1xuICBlbHNlIHtcbiAgICAvLyBMb29rIHJlbGF0aXZlIHRvIGEgcGFzc2VkIGZpbGVuYW1lIGZpcnN0XG4gICAgaWYgKG9wdGlvbnMuZmlsZW5hbWUpIHtcbiAgICAgIGZpbGVQYXRoID0gZXhwb3J0cy5yZXNvbHZlSW5jbHVkZShwYXRoLCBvcHRpb25zLmZpbGVuYW1lKTtcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGVQYXRoKSkge1xuICAgICAgICBpbmNsdWRlUGF0aCA9IGZpbGVQYXRoO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBUaGVuIGxvb2sgaW4gYW55IHZpZXdzIGRpcmVjdG9yaWVzXG4gICAgaWYgKCFpbmNsdWRlUGF0aCkge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmlld3MpICYmIHZpZXdzLnNvbWUoZnVuY3Rpb24gKHYpIHtcbiAgICAgICAgZmlsZVBhdGggPSBleHBvcnRzLnJlc29sdmVJbmNsdWRlKHBhdGgsIHYsIHRydWUpO1xuICAgICAgICByZXR1cm4gZnMuZXhpc3RzU3luYyhmaWxlUGF0aCk7XG4gICAgICB9KSkge1xuICAgICAgICBpbmNsdWRlUGF0aCA9IGZpbGVQYXRoO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIWluY2x1ZGVQYXRoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBmaW5kIHRoZSBpbmNsdWRlIGZpbGUgXCInICtcbiAgICAgICAgICBvcHRpb25zLmVzY2FwZUZ1bmN0aW9uKHBhdGgpICsgJ1wiJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBpbmNsdWRlUGF0aDtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIHRlbXBsYXRlIGZyb20gYSBzdHJpbmcgb3IgYSBmaWxlLCBlaXRoZXIgY29tcGlsZWQgb24tdGhlLWZseSBvclxuICogcmVhZCBmcm9tIGNhY2hlIChpZiBlbmFibGVkKSwgYW5kIGNhY2hlIHRoZSB0ZW1wbGF0ZSBpZiBuZWVkZWQuXG4gKlxuICogSWYgYHRlbXBsYXRlYCBpcyBub3Qgc2V0LCB0aGUgZmlsZSBzcGVjaWZpZWQgaW4gYG9wdGlvbnMuZmlsZW5hbWVgIHdpbGwgYmVcbiAqIHJlYWQuXG4gKlxuICogSWYgYG9wdGlvbnMuY2FjaGVgIGlzIHRydWUsIHRoaXMgZnVuY3Rpb24gcmVhZHMgdGhlIGZpbGUgZnJvbVxuICogYG9wdGlvbnMuZmlsZW5hbWVgIHNvIGl0IG11c3QgYmUgc2V0IHByaW9yIHRvIGNhbGxpbmcgdGhpcyBmdW5jdGlvbi5cbiAqXG4gKiBAbWVtYmVyb2YgbW9kdWxlOmVqcy1pbnRlcm5hbFxuICogQHBhcmFtIHtPcHRpb25zfSBvcHRpb25zICAgY29tcGlsYXRpb24gb3B0aW9uc1xuICogQHBhcmFtIHtTdHJpbmd9IFt0ZW1wbGF0ZV0gdGVtcGxhdGUgc291cmNlXG4gKiBAcmV0dXJuIHsoVGVtcGxhdGVGdW5jdGlvbnxDbGllbnRGdW5jdGlvbil9XG4gKiBEZXBlbmRpbmcgb24gdGhlIHZhbHVlIG9mIGBvcHRpb25zLmNsaWVudGAsIGVpdGhlciB0eXBlIG1pZ2h0IGJlIHJldHVybmVkLlxuICogQHN0YXRpY1xuICovXG5cbmZ1bmN0aW9uIGhhbmRsZUNhY2hlKG9wdGlvbnMsIHRlbXBsYXRlKSB7XG4gIHZhciBmdW5jO1xuICB2YXIgZmlsZW5hbWUgPSBvcHRpb25zLmZpbGVuYW1lO1xuICB2YXIgaGFzVGVtcGxhdGUgPSBhcmd1bWVudHMubGVuZ3RoID4gMTtcblxuICBpZiAob3B0aW9ucy5jYWNoZSkge1xuICAgIGlmICghZmlsZW5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignY2FjaGUgb3B0aW9uIHJlcXVpcmVzIGEgZmlsZW5hbWUnKTtcbiAgICB9XG4gICAgZnVuYyA9IGV4cG9ydHMuY2FjaGUuZ2V0KGZpbGVuYW1lKTtcbiAgICBpZiAoZnVuYykge1xuICAgICAgcmV0dXJuIGZ1bmM7XG4gICAgfVxuICAgIGlmICghaGFzVGVtcGxhdGUpIHtcbiAgICAgIHRlbXBsYXRlID0gZmlsZUxvYWRlcihmaWxlbmFtZSkudG9TdHJpbmcoKS5yZXBsYWNlKF9CT00sICcnKTtcbiAgICB9XG4gIH1cbiAgZWxzZSBpZiAoIWhhc1RlbXBsYXRlKSB7XG4gICAgLy8gaXN0YW5idWwgaWdub3JlIGlmOiBzaG91bGQgbm90IGhhcHBlbiBhdCBhbGxcbiAgICBpZiAoIWZpbGVuYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludGVybmFsIEVKUyBlcnJvcjogbm8gZmlsZSBuYW1lIG9yIHRlbXBsYXRlICdcbiAgICAgICAgICAgICAgICAgICAgKyAncHJvdmlkZWQnKTtcbiAgICB9XG4gICAgdGVtcGxhdGUgPSBmaWxlTG9hZGVyKGZpbGVuYW1lKS50b1N0cmluZygpLnJlcGxhY2UoX0JPTSwgJycpO1xuICB9XG4gIGZ1bmMgPSBleHBvcnRzLmNvbXBpbGUodGVtcGxhdGUsIG9wdGlvbnMpO1xuICBpZiAob3B0aW9ucy5jYWNoZSkge1xuICAgIGV4cG9ydHMuY2FjaGUuc2V0KGZpbGVuYW1lLCBmdW5jKTtcbiAgfVxuICByZXR1cm4gZnVuYztcbn1cblxuLyoqXG4gKiBUcnkgY2FsbGluZyBoYW5kbGVDYWNoZSB3aXRoIHRoZSBnaXZlbiBvcHRpb25zIGFuZCBkYXRhIGFuZCBjYWxsIHRoZVxuICogY2FsbGJhY2sgd2l0aCB0aGUgcmVzdWx0LiBJZiBhbiBlcnJvciBvY2N1cnMsIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGhcbiAqIHRoZSBlcnJvci4gVXNlZCBieSByZW5kZXJGaWxlKCkuXG4gKlxuICogQG1lbWJlcm9mIG1vZHVsZTplanMtaW50ZXJuYWxcbiAqIEBwYXJhbSB7T3B0aW9uc30gb3B0aW9ucyAgICBjb21waWxhdGlvbiBvcHRpb25zXG4gKiBAcGFyYW0ge09iamVjdH0gZGF0YSAgICAgICAgdGVtcGxhdGUgZGF0YVxuICogQHBhcmFtIHtSZW5kZXJGaWxlQ2FsbGJhY2t9IGNiIGNhbGxiYWNrXG4gKiBAc3RhdGljXG4gKi9cblxuZnVuY3Rpb24gdHJ5SGFuZGxlQ2FjaGUob3B0aW9ucywgZGF0YSwgY2IpIHtcbiAgdmFyIHJlc3VsdDtcbiAgaWYgKCFjYikge1xuICAgIGlmICh0eXBlb2YgZXhwb3J0cy5wcm9taXNlSW1wbCA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gbmV3IGV4cG9ydHMucHJvbWlzZUltcGwoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlc3VsdCA9IGhhbmRsZUNhY2hlKG9wdGlvbnMpKGRhdGEpO1xuICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHByb3ZpZGUgYSBjYWxsYmFjayBmdW5jdGlvbicpO1xuICAgIH1cbiAgfVxuICBlbHNlIHtcbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gaGFuZGxlQ2FjaGUob3B0aW9ucykoZGF0YSk7XG4gICAgfVxuICAgIGNhdGNoIChlcnIpIHtcbiAgICAgIHJldHVybiBjYihlcnIpO1xuICAgIH1cblxuICAgIGNiKG51bGwsIHJlc3VsdCk7XG4gIH1cbn1cblxuLyoqXG4gKiBmaWxlTG9hZGVyIGlzIGluZGVwZW5kZW50XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGZpbGVQYXRoIGVqcyBmaWxlIHBhdGguXG4gKiBAcmV0dXJuIHtTdHJpbmd9IFRoZSBjb250ZW50cyBvZiB0aGUgc3BlY2lmaWVkIGZpbGUuXG4gKiBAc3RhdGljXG4gKi9cblxuZnVuY3Rpb24gZmlsZUxvYWRlcihmaWxlUGF0aCl7XG4gIHJldHVybiBleHBvcnRzLmZpbGVMb2FkZXIoZmlsZVBhdGgpO1xufVxuXG4vKipcbiAqIEdldCB0aGUgdGVtcGxhdGUgZnVuY3Rpb24uXG4gKlxuICogSWYgYG9wdGlvbnMuY2FjaGVgIGlzIGB0cnVlYCwgdGhlbiB0aGUgdGVtcGxhdGUgaXMgY2FjaGVkLlxuICpcbiAqIEBtZW1iZXJvZiBtb2R1bGU6ZWpzLWludGVybmFsXG4gKiBAcGFyYW0ge1N0cmluZ30gIHBhdGggICAgcGF0aCBmb3IgdGhlIHNwZWNpZmllZCBmaWxlXG4gKiBAcGFyYW0ge09wdGlvbnN9IG9wdGlvbnMgY29tcGlsYXRpb24gb3B0aW9uc1xuICogQHJldHVybiB7KFRlbXBsYXRlRnVuY3Rpb258Q2xpZW50RnVuY3Rpb24pfVxuICogRGVwZW5kaW5nIG9uIHRoZSB2YWx1ZSBvZiBgb3B0aW9ucy5jbGllbnRgLCBlaXRoZXIgdHlwZSBtaWdodCBiZSByZXR1cm5lZFxuICogQHN0YXRpY1xuICovXG5cbmZ1bmN0aW9uIGluY2x1ZGVGaWxlKHBhdGgsIG9wdGlvbnMpIHtcbiAgdmFyIG9wdHMgPSB1dGlscy5zaGFsbG93Q29weSh7fSwgb3B0aW9ucyk7XG4gIG9wdHMuZmlsZW5hbWUgPSBnZXRJbmNsdWRlUGF0aChwYXRoLCBvcHRzKTtcbiAgcmV0dXJuIGhhbmRsZUNhY2hlKG9wdHMpO1xufVxuXG4vKipcbiAqIEdldCB0aGUgSmF2YVNjcmlwdCBzb3VyY2Ugb2YgYW4gaW5jbHVkZWQgZmlsZS5cbiAqXG4gKiBAbWVtYmVyb2YgbW9kdWxlOmVqcy1pbnRlcm5hbFxuICogQHBhcmFtIHtTdHJpbmd9ICBwYXRoICAgIHBhdGggZm9yIHRoZSBzcGVjaWZpZWQgZmlsZVxuICogQHBhcmFtIHtPcHRpb25zfSBvcHRpb25zIGNvbXBpbGF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm4ge09iamVjdH1cbiAqIEBzdGF0aWNcbiAqL1xuXG5mdW5jdGlvbiBpbmNsdWRlU291cmNlKHBhdGgsIG9wdGlvbnMpIHtcbiAgdmFyIG9wdHMgPSB1dGlscy5zaGFsbG93Q29weSh7fSwgb3B0aW9ucyk7XG4gIHZhciBpbmNsdWRlUGF0aDtcbiAgdmFyIHRlbXBsYXRlO1xuICBpbmNsdWRlUGF0aCA9IGdldEluY2x1ZGVQYXRoKHBhdGgsIG9wdHMpO1xuICB0ZW1wbGF0ZSA9IGZpbGVMb2FkZXIoaW5jbHVkZVBhdGgpLnRvU3RyaW5nKCkucmVwbGFjZShfQk9NLCAnJyk7XG4gIG9wdHMuZmlsZW5hbWUgPSBpbmNsdWRlUGF0aDtcbiAgdmFyIHRlbXBsID0gbmV3IFRlbXBsYXRlKHRlbXBsYXRlLCBvcHRzKTtcbiAgdGVtcGwuZ2VuZXJhdGVTb3VyY2UoKTtcbiAgcmV0dXJuIHtcbiAgICBzb3VyY2U6IHRlbXBsLnNvdXJjZSxcbiAgICBmaWxlbmFtZTogaW5jbHVkZVBhdGgsXG4gICAgdGVtcGxhdGU6IHRlbXBsYXRlXG4gIH07XG59XG5cbi8qKlxuICogUmUtdGhyb3cgdGhlIGdpdmVuIGBlcnJgIGluIGNvbnRleHQgdG8gdGhlIGBzdHJgIG9mIGVqcywgYGZpbGVuYW1lYCwgYW5kXG4gKiBgbGluZW5vYC5cbiAqXG4gKiBAaW1wbGVtZW50cyBSZXRocm93Q2FsbGJhY2tcbiAqIEBtZW1iZXJvZiBtb2R1bGU6ZWpzLWludGVybmFsXG4gKiBAcGFyYW0ge0Vycm9yfSAgZXJyICAgICAgRXJyb3Igb2JqZWN0XG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyICAgICAgRUpTIHNvdXJjZVxuICogQHBhcmFtIHtTdHJpbmd9IGZpbGVuYW1lIGZpbGUgbmFtZSBvZiB0aGUgRUpTIGZpbGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBsaW5lbm8gICBsaW5lIG51bWJlciBvZiB0aGUgZXJyb3JcbiAqIEBzdGF0aWNcbiAqL1xuXG5mdW5jdGlvbiByZXRocm93KGVyciwgc3RyLCBmbG5tLCBsaW5lbm8sIGVzYyl7XG4gIHZhciBsaW5lcyA9IHN0ci5zcGxpdCgnXFxuJyk7XG4gIHZhciBzdGFydCA9IE1hdGgubWF4KGxpbmVubyAtIDMsIDApO1xuICB2YXIgZW5kID0gTWF0aC5taW4obGluZXMubGVuZ3RoLCBsaW5lbm8gKyAzKTtcbiAgdmFyIGZpbGVuYW1lID0gZXNjKGZsbm0pOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lXG4gIC8vIEVycm9yIGNvbnRleHRcbiAgdmFyIGNvbnRleHQgPSBsaW5lcy5zbGljZShzdGFydCwgZW5kKS5tYXAoZnVuY3Rpb24gKGxpbmUsIGkpe1xuICAgIHZhciBjdXJyID0gaSArIHN0YXJ0ICsgMTtcbiAgICByZXR1cm4gKGN1cnIgPT0gbGluZW5vID8gJyA+PiAnIDogJyAgICAnKVxuICAgICAgKyBjdXJyXG4gICAgICArICd8ICdcbiAgICAgICsgbGluZTtcbiAgfSkuam9pbignXFxuJyk7XG5cbiAgLy8gQWx0ZXIgZXhjZXB0aW9uIG1lc3NhZ2VcbiAgZXJyLnBhdGggPSBmaWxlbmFtZTtcbiAgZXJyLm1lc3NhZ2UgPSAoZmlsZW5hbWUgfHwgJ2VqcycpICsgJzonXG4gICAgKyBsaW5lbm8gKyAnXFxuJ1xuICAgICsgY29udGV4dCArICdcXG5cXG4nXG4gICAgKyBlcnIubWVzc2FnZTtcblxuICB0aHJvdyBlcnI7XG59XG5cbmZ1bmN0aW9uIHN0cmlwU2VtaShzdHIpe1xuICByZXR1cm4gc3RyLnJlcGxhY2UoLzsoXFxzKiQpLywgJyQxJyk7XG59XG5cbi8qKlxuICogQ29tcGlsZSB0aGUgZ2l2ZW4gYHN0cmAgb2YgZWpzIGludG8gYSB0ZW1wbGF0ZSBmdW5jdGlvbi5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gIHRlbXBsYXRlIEVKUyB0ZW1wbGF0ZVxuICpcbiAqIEBwYXJhbSB7T3B0aW9uc30gb3B0cyAgICAgY29tcGlsYXRpb24gb3B0aW9uc1xuICpcbiAqIEByZXR1cm4geyhUZW1wbGF0ZUZ1bmN0aW9ufENsaWVudEZ1bmN0aW9uKX1cbiAqIERlcGVuZGluZyBvbiB0aGUgdmFsdWUgb2YgYG9wdHMuY2xpZW50YCwgZWl0aGVyIHR5cGUgbWlnaHQgYmUgcmV0dXJuZWQuXG4gKiBOb3RlIHRoYXQgdGhlIHJldHVybiB0eXBlIG9mIHRoZSBmdW5jdGlvbiBhbHNvIGRlcGVuZHMgb24gdGhlIHZhbHVlIG9mIGBvcHRzLmFzeW5jYC5cbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLmNvbXBpbGUgPSBmdW5jdGlvbiBjb21waWxlKHRlbXBsYXRlLCBvcHRzKSB7XG4gIHZhciB0ZW1wbDtcblxuICAvLyB2MSBjb21wYXRcbiAgLy8gJ3Njb3BlJyBpcyAnY29udGV4dCdcbiAgLy8gRklYTUU6IFJlbW92ZSB0aGlzIGluIGEgZnV0dXJlIHZlcnNpb25cbiAgaWYgKG9wdHMgJiYgb3B0cy5zY29wZSkge1xuICAgIGlmICghc2NvcGVPcHRpb25XYXJuZWQpe1xuICAgICAgY29uc29sZS53YXJuKCdgc2NvcGVgIG9wdGlvbiBpcyBkZXByZWNhdGVkIGFuZCB3aWxsIGJlIHJlbW92ZWQgaW4gRUpTIDMnKTtcbiAgICAgIHNjb3BlT3B0aW9uV2FybmVkID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKCFvcHRzLmNvbnRleHQpIHtcbiAgICAgIG9wdHMuY29udGV4dCA9IG9wdHMuc2NvcGU7XG4gICAgfVxuICAgIGRlbGV0ZSBvcHRzLnNjb3BlO1xuICB9XG4gIHRlbXBsID0gbmV3IFRlbXBsYXRlKHRlbXBsYXRlLCBvcHRzKTtcbiAgcmV0dXJuIHRlbXBsLmNvbXBpbGUoKTtcbn07XG5cbi8qKlxuICogUmVuZGVyIHRoZSBnaXZlbiBgdGVtcGxhdGVgIG9mIGVqcy5cbiAqXG4gKiBJZiB5b3Ugd291bGQgbGlrZSB0byBpbmNsdWRlIG9wdGlvbnMgYnV0IG5vdCBkYXRhLCB5b3UgbmVlZCB0byBleHBsaWNpdGx5XG4gKiBjYWxsIHRoaXMgZnVuY3Rpb24gd2l0aCBgZGF0YWAgYmVpbmcgYW4gZW1wdHkgb2JqZWN0IG9yIGBudWxsYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gICB0ZW1wbGF0ZSBFSlMgdGVtcGxhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSAgW2RhdGE9e31dIHRlbXBsYXRlIGRhdGFcbiAqIEBwYXJhbSB7T3B0aW9uc30gW29wdHM9e31dIGNvbXBpbGF0aW9uIGFuZCByZW5kZXJpbmcgb3B0aW9uc1xuICogQHJldHVybiB7KFN0cmluZ3xQcm9taXNlPFN0cmluZz4pfVxuICogUmV0dXJuIHZhbHVlIHR5cGUgZGVwZW5kcyBvbiBgb3B0cy5hc3luY2AuXG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5yZW5kZXIgPSBmdW5jdGlvbiAodGVtcGxhdGUsIGQsIG8pIHtcbiAgdmFyIGRhdGEgPSBkIHx8IHt9O1xuICB2YXIgb3B0cyA9IG8gfHwge307XG5cbiAgLy8gTm8gb3B0aW9ucyBvYmplY3QgLS0gaWYgdGhlcmUgYXJlIG9wdGlvbnkgbmFtZXNcbiAgLy8gaW4gdGhlIGRhdGEsIGNvcHkgdGhlbSB0byBvcHRpb25zXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09IDIpIHtcbiAgICB1dGlscy5zaGFsbG93Q29weUZyb21MaXN0KG9wdHMsIGRhdGEsIF9PUFRTX1BBU1NBQkxFX1dJVEhfREFUQSk7XG4gIH1cblxuICByZXR1cm4gaGFuZGxlQ2FjaGUob3B0cywgdGVtcGxhdGUpKGRhdGEpO1xufTtcblxuLyoqXG4gKiBSZW5kZXIgYW4gRUpTIGZpbGUgYXQgdGhlIGdpdmVuIGBwYXRoYCBhbmQgY2FsbGJhY2sgYGNiKGVyciwgc3RyKWAuXG4gKlxuICogSWYgeW91IHdvdWxkIGxpa2UgdG8gaW5jbHVkZSBvcHRpb25zIGJ1dCBub3QgZGF0YSwgeW91IG5lZWQgdG8gZXhwbGljaXRseVxuICogY2FsbCB0aGlzIGZ1bmN0aW9uIHdpdGggYGRhdGFgIGJlaW5nIGFuIGVtcHR5IG9iamVjdCBvciBgbnVsbGAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9ICAgICAgICAgICAgIHBhdGggICAgIHBhdGggdG8gdGhlIEVKUyBmaWxlXG4gKiBAcGFyYW0ge09iamVjdH0gICAgICAgICAgICBbZGF0YT17fV0gdGVtcGxhdGUgZGF0YVxuICogQHBhcmFtIHtPcHRpb25zfSAgICAgICAgICAgW29wdHM9e31dIGNvbXBpbGF0aW9uIGFuZCByZW5kZXJpbmcgb3B0aW9uc1xuICogQHBhcmFtIHtSZW5kZXJGaWxlQ2FsbGJhY2t9IGNiIGNhbGxiYWNrXG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5yZW5kZXJGaWxlID0gZnVuY3Rpb24gKCkge1xuICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gIHZhciBmaWxlbmFtZSA9IGFyZ3Muc2hpZnQoKTtcbiAgdmFyIGNiO1xuICB2YXIgb3B0cyA9IHtmaWxlbmFtZTogZmlsZW5hbWV9O1xuICB2YXIgZGF0YTtcbiAgdmFyIHZpZXdPcHRzO1xuXG4gIC8vIERvIHdlIGhhdmUgYSBjYWxsYmFjaz9cbiAgaWYgKHR5cGVvZiBhcmd1bWVudHNbYXJndW1lbnRzLmxlbmd0aCAtIDFdID09ICdmdW5jdGlvbicpIHtcbiAgICBjYiA9IGFyZ3MucG9wKCk7XG4gIH1cbiAgLy8gRG8gd2UgaGF2ZSBkYXRhL29wdHM/XG4gIGlmIChhcmdzLmxlbmd0aCkge1xuICAgIC8vIFNob3VsZCBhbHdheXMgaGF2ZSBkYXRhIG9ialxuICAgIGRhdGEgPSBhcmdzLnNoaWZ0KCk7XG4gICAgLy8gTm9ybWFsIHBhc3NlZCBvcHRzIChkYXRhIG9iaiArIG9wdHMgb2JqKVxuICAgIGlmIChhcmdzLmxlbmd0aCkge1xuICAgICAgLy8gVXNlIHNoYWxsb3dDb3B5IHNvIHdlIGRvbid0IHBvbGx1dGUgcGFzc2VkIGluIG9wdHMgb2JqIHdpdGggbmV3IHZhbHNcbiAgICAgIHV0aWxzLnNoYWxsb3dDb3B5KG9wdHMsIGFyZ3MucG9wKCkpO1xuICAgIH1cbiAgICAvLyBTcGVjaWFsIGNhc2luZyBmb3IgRXhwcmVzcyAoc2V0dGluZ3MgKyBvcHRzLWluLWRhdGEpXG4gICAgZWxzZSB7XG4gICAgICAvLyBFeHByZXNzIDMgYW5kIDRcbiAgICAgIGlmIChkYXRhLnNldHRpbmdzKSB7XG4gICAgICAgIC8vIFB1bGwgYSBmZXcgdGhpbmdzIGZyb20ga25vd24gbG9jYXRpb25zXG4gICAgICAgIGlmIChkYXRhLnNldHRpbmdzLnZpZXdzKSB7XG4gICAgICAgICAgb3B0cy52aWV3cyA9IGRhdGEuc2V0dGluZ3Mudmlld3M7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRhdGEuc2V0dGluZ3NbJ3ZpZXcgY2FjaGUnXSkge1xuICAgICAgICAgIG9wdHMuY2FjaGUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIC8vIFVuZG9jdW1lbnRlZCBhZnRlciBFeHByZXNzIDIsIGJ1dCBzdGlsbCB1c2FibGUsIGVzcC4gZm9yXG4gICAgICAgIC8vIGl0ZW1zIHRoYXQgYXJlIHVuc2FmZSB0byBiZSBwYXNzZWQgYWxvbmcgd2l0aCBkYXRhLCBsaWtlIGByb290YFxuICAgICAgICB2aWV3T3B0cyA9IGRhdGEuc2V0dGluZ3NbJ3ZpZXcgb3B0aW9ucyddO1xuICAgICAgICBpZiAodmlld09wdHMpIHtcbiAgICAgICAgICB1dGlscy5zaGFsbG93Q29weShvcHRzLCB2aWV3T3B0cyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIEV4cHJlc3MgMiBhbmQgbG93ZXIsIHZhbHVlcyBzZXQgaW4gYXBwLmxvY2Fscywgb3IgcGVvcGxlIHdobyBqdXN0XG4gICAgICAvLyB3YW50IHRvIHBhc3Mgb3B0aW9ucyBpbiB0aGVpciBkYXRhLiBOT1RFOiBUaGVzZSB2YWx1ZXMgd2lsbCBvdmVycmlkZVxuICAgICAgLy8gYW55dGhpbmcgcHJldmlvdXNseSBzZXQgaW4gc2V0dGluZ3MgIG9yIHNldHRpbmdzWyd2aWV3IG9wdGlvbnMnXVxuICAgICAgdXRpbHMuc2hhbGxvd0NvcHlGcm9tTGlzdChvcHRzLCBkYXRhLCBfT1BUU19QQVNTQUJMRV9XSVRIX0RBVEFfRVhQUkVTUyk7XG4gICAgfVxuICAgIG9wdHMuZmlsZW5hbWUgPSBmaWxlbmFtZTtcbiAgfVxuICBlbHNlIHtcbiAgICBkYXRhID0ge307XG4gIH1cblxuICByZXR1cm4gdHJ5SGFuZGxlQ2FjaGUob3B0cywgZGF0YSwgY2IpO1xufTtcblxuLyoqXG4gKiBDbGVhciBpbnRlcm1lZGlhdGUgSmF2YVNjcmlwdCBjYWNoZS4gQ2FsbHMge0BsaW5rIENhY2hlI3Jlc2V0fS5cbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLmNsZWFyQ2FjaGUgPSBmdW5jdGlvbiAoKSB7XG4gIGV4cG9ydHMuY2FjaGUucmVzZXQoKTtcbn07XG5cbmZ1bmN0aW9uIFRlbXBsYXRlKHRleHQsIG9wdHMpIHtcbiAgb3B0cyA9IG9wdHMgfHwge307XG4gIHZhciBvcHRpb25zID0ge307XG4gIHRoaXMudGVtcGxhdGVUZXh0ID0gdGV4dDtcbiAgdGhpcy5tb2RlID0gbnVsbDtcbiAgdGhpcy50cnVuY2F0ZSA9IGZhbHNlO1xuICB0aGlzLmN1cnJlbnRMaW5lID0gMTtcbiAgdGhpcy5zb3VyY2UgPSAnJztcbiAgdGhpcy5kZXBlbmRlbmNpZXMgPSBbXTtcbiAgb3B0aW9ucy5jbGllbnQgPSBvcHRzLmNsaWVudCB8fCBmYWxzZTtcbiAgb3B0aW9ucy5lc2NhcGVGdW5jdGlvbiA9IG9wdHMuZXNjYXBlIHx8IHV0aWxzLmVzY2FwZVhNTDtcbiAgb3B0aW9ucy5jb21waWxlRGVidWcgPSBvcHRzLmNvbXBpbGVEZWJ1ZyAhPT0gZmFsc2U7XG4gIG9wdGlvbnMuZGVidWcgPSAhIW9wdHMuZGVidWc7XG4gIG9wdGlvbnMuZmlsZW5hbWUgPSBvcHRzLmZpbGVuYW1lO1xuICBvcHRpb25zLmRlbGltaXRlciA9IG9wdHMuZGVsaW1pdGVyIHx8IGV4cG9ydHMuZGVsaW1pdGVyIHx8IF9ERUZBVUxUX0RFTElNSVRFUjtcbiAgb3B0aW9ucy5zdHJpY3QgPSBvcHRzLnN0cmljdCB8fCBmYWxzZTtcbiAgb3B0aW9ucy5jb250ZXh0ID0gb3B0cy5jb250ZXh0O1xuICBvcHRpb25zLmNhY2hlID0gb3B0cy5jYWNoZSB8fCBmYWxzZTtcbiAgb3B0aW9ucy5ybVdoaXRlc3BhY2UgPSBvcHRzLnJtV2hpdGVzcGFjZTtcbiAgb3B0aW9ucy5yb290ID0gb3B0cy5yb290O1xuICBvcHRpb25zLm91dHB1dEZ1bmN0aW9uTmFtZSA9IG9wdHMub3V0cHV0RnVuY3Rpb25OYW1lO1xuICBvcHRpb25zLmxvY2Fsc05hbWUgPSBvcHRzLmxvY2Fsc05hbWUgfHwgZXhwb3J0cy5sb2NhbHNOYW1lIHx8IF9ERUZBVUxUX0xPQ0FMU19OQU1FO1xuICBvcHRpb25zLnZpZXdzID0gb3B0cy52aWV3cztcbiAgb3B0aW9ucy5hc3luYyA9IG9wdHMuYXN5bmM7XG5cbiAgaWYgKG9wdGlvbnMuc3RyaWN0KSB7XG4gICAgb3B0aW9ucy5fd2l0aCA9IGZhbHNlO1xuICB9XG4gIGVsc2Uge1xuICAgIG9wdGlvbnMuX3dpdGggPSB0eXBlb2Ygb3B0cy5fd2l0aCAhPSAndW5kZWZpbmVkJyA/IG9wdHMuX3dpdGggOiB0cnVlO1xuICB9XG5cbiAgdGhpcy5vcHRzID0gb3B0aW9ucztcblxuICB0aGlzLnJlZ2V4ID0gdGhpcy5jcmVhdGVSZWdleCgpO1xufVxuXG5UZW1wbGF0ZS5tb2RlcyA9IHtcbiAgRVZBTDogJ2V2YWwnLFxuICBFU0NBUEVEOiAnZXNjYXBlZCcsXG4gIFJBVzogJ3JhdycsXG4gIENPTU1FTlQ6ICdjb21tZW50JyxcbiAgTElURVJBTDogJ2xpdGVyYWwnXG59O1xuXG5UZW1wbGF0ZS5wcm90b3R5cGUgPSB7XG4gIGNyZWF0ZVJlZ2V4OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHN0ciA9IF9SRUdFWF9TVFJJTkc7XG4gICAgdmFyIGRlbGltID0gdXRpbHMuZXNjYXBlUmVnRXhwQ2hhcnModGhpcy5vcHRzLmRlbGltaXRlcik7XG4gICAgc3RyID0gc3RyLnJlcGxhY2UoLyUvZywgZGVsaW0pO1xuICAgIHJldHVybiBuZXcgUmVnRXhwKHN0cik7XG4gIH0sXG5cbiAgY29tcGlsZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzcmM7XG4gICAgdmFyIGZuO1xuICAgIHZhciBvcHRzID0gdGhpcy5vcHRzO1xuICAgIHZhciBwcmVwZW5kZWQgPSAnJztcbiAgICB2YXIgYXBwZW5kZWQgPSAnJztcbiAgICB2YXIgZXNjYXBlRm4gPSBvcHRzLmVzY2FwZUZ1bmN0aW9uO1xuICAgIHZhciBhc3luY0N0b3I7XG5cbiAgICBpZiAoIXRoaXMuc291cmNlKSB7XG4gICAgICB0aGlzLmdlbmVyYXRlU291cmNlKCk7XG4gICAgICBwcmVwZW5kZWQgKz0gJyAgdmFyIF9fb3V0cHV0ID0gW10sIF9fYXBwZW5kID0gX19vdXRwdXQucHVzaC5iaW5kKF9fb3V0cHV0KTsnICsgJ1xcbic7XG4gICAgICBpZiAob3B0cy5vdXRwdXRGdW5jdGlvbk5hbWUpIHtcbiAgICAgICAgcHJlcGVuZGVkICs9ICcgIHZhciAnICsgb3B0cy5vdXRwdXRGdW5jdGlvbk5hbWUgKyAnID0gX19hcHBlbmQ7JyArICdcXG4nO1xuICAgICAgfVxuICAgICAgaWYgKG9wdHMuX3dpdGggIT09IGZhbHNlKSB7XG4gICAgICAgIHByZXBlbmRlZCArPSAgJyAgd2l0aCAoJyArIG9wdHMubG9jYWxzTmFtZSArICcgfHwge30pIHsnICsgJ1xcbic7XG4gICAgICAgIGFwcGVuZGVkICs9ICcgIH0nICsgJ1xcbic7XG4gICAgICB9XG4gICAgICBhcHBlbmRlZCArPSAnICByZXR1cm4gX19vdXRwdXQuam9pbihcIlwiKTsnICsgJ1xcbic7XG4gICAgICB0aGlzLnNvdXJjZSA9IHByZXBlbmRlZCArIHRoaXMuc291cmNlICsgYXBwZW5kZWQ7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuY29tcGlsZURlYnVnKSB7XG4gICAgICBzcmMgPSAndmFyIF9fbGluZSA9IDEnICsgJ1xcbidcbiAgICAgICAgKyAnICAsIF9fbGluZXMgPSAnICsgSlNPTi5zdHJpbmdpZnkodGhpcy50ZW1wbGF0ZVRleHQpICsgJ1xcbidcbiAgICAgICAgKyAnICAsIF9fZmlsZW5hbWUgPSAnICsgKG9wdHMuZmlsZW5hbWUgP1xuICAgICAgICBKU09OLnN0cmluZ2lmeShvcHRzLmZpbGVuYW1lKSA6ICd1bmRlZmluZWQnKSArICc7JyArICdcXG4nXG4gICAgICAgICsgJ3RyeSB7JyArICdcXG4nXG4gICAgICAgICsgdGhpcy5zb3VyY2VcbiAgICAgICAgKyAnfSBjYXRjaCAoZSkgeycgKyAnXFxuJ1xuICAgICAgICArICcgIHJldGhyb3coZSwgX19saW5lcywgX19maWxlbmFtZSwgX19saW5lLCBlc2NhcGVGbik7JyArICdcXG4nXG4gICAgICAgICsgJ30nICsgJ1xcbic7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgc3JjID0gdGhpcy5zb3VyY2U7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuY2xpZW50KSB7XG4gICAgICBzcmMgPSAnZXNjYXBlRm4gPSBlc2NhcGVGbiB8fCAnICsgZXNjYXBlRm4udG9TdHJpbmcoKSArICc7JyArICdcXG4nICsgc3JjO1xuICAgICAgaWYgKG9wdHMuY29tcGlsZURlYnVnKSB7XG4gICAgICAgIHNyYyA9ICdyZXRocm93ID0gcmV0aHJvdyB8fCAnICsgcmV0aHJvdy50b1N0cmluZygpICsgJzsnICsgJ1xcbicgKyBzcmM7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuc3RyaWN0KSB7XG4gICAgICBzcmMgPSAnXCJ1c2Ugc3RyaWN0XCI7XFxuJyArIHNyYztcbiAgICB9XG4gICAgaWYgKG9wdHMuZGVidWcpIHtcbiAgICAgIGNvbnNvbGUubG9nKHNyYyk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChvcHRzLmFzeW5jKSB7XG4gICAgICAgIC8vIEhhdmUgdG8gdXNlIGdlbmVyYXRlZCBmdW5jdGlvbiBmb3IgdGhpcywgc2luY2UgaW4gZW52cyB3aXRob3V0IHN1cHBvcnQsXG4gICAgICAgIC8vIGl0IGJyZWFrcyBpbiBwYXJzaW5nXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXN5bmNDdG9yID0gKG5ldyBGdW5jdGlvbigncmV0dXJuIChhc3luYyBmdW5jdGlvbigpe30pLmNvbnN0cnVjdG9yOycpKSgpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoKGUpIHtcbiAgICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIFN5bnRheEVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoaXMgZW52aXJvbm1lbnQgZG9lcyBub3Qgc3VwcG9ydCBhc3luYy9hd2FpdCcpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgYXN5bmNDdG9yID0gRnVuY3Rpb247XG4gICAgICB9XG4gICAgICBmbiA9IG5ldyBhc3luY0N0b3Iob3B0cy5sb2NhbHNOYW1lICsgJywgZXNjYXBlRm4sIGluY2x1ZGUsIHJldGhyb3cnLCBzcmMpO1xuICAgIH1cbiAgICBjYXRjaChlKSB7XG4gICAgICAvLyBpc3RhbmJ1bCBpZ25vcmUgZWxzZVxuICAgICAgaWYgKGUgaW5zdGFuY2VvZiBTeW50YXhFcnJvcikge1xuICAgICAgICBpZiAob3B0cy5maWxlbmFtZSkge1xuICAgICAgICAgIGUubWVzc2FnZSArPSAnIGluICcgKyBvcHRzLmZpbGVuYW1lO1xuICAgICAgICB9XG4gICAgICAgIGUubWVzc2FnZSArPSAnIHdoaWxlIGNvbXBpbGluZyBlanNcXG5cXG4nO1xuICAgICAgICBlLm1lc3NhZ2UgKz0gJ0lmIHRoZSBhYm92ZSBlcnJvciBpcyBub3QgaGVscGZ1bCwgeW91IG1heSB3YW50IHRvIHRyeSBFSlMtTGludDpcXG4nO1xuICAgICAgICBlLm1lc3NhZ2UgKz0gJ2h0dHBzOi8vZ2l0aHViLmNvbS9SeWFuWmltL0VKUy1MaW50JztcbiAgICAgICAgaWYgKCFlLmFzeW5jKSB7XG4gICAgICAgICAgZS5tZXNzYWdlICs9ICdcXG4nO1xuICAgICAgICAgIGUubWVzc2FnZSArPSAnT3IsIGlmIHlvdSBtZWFudCB0byBjcmVhdGUgYW4gYXN5bmMgZnVuY3Rpb24sIHBhc3MgYXN5bmM6IHRydWUgYXMgYW4gb3B0aW9uLic7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuY2xpZW50KSB7XG4gICAgICBmbi5kZXBlbmRlbmNpZXMgPSB0aGlzLmRlcGVuZGVuY2llcztcbiAgICAgIHJldHVybiBmbjtcbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gYSBjYWxsYWJsZSBmdW5jdGlvbiB3aGljaCB3aWxsIGV4ZWN1dGUgdGhlIGZ1bmN0aW9uXG4gICAgLy8gY3JlYXRlZCBieSB0aGUgc291cmNlLWNvZGUsIHdpdGggdGhlIHBhc3NlZCBkYXRhIGFzIGxvY2Fsc1xuICAgIC8vIEFkZHMgYSBsb2NhbCBgaW5jbHVkZWAgZnVuY3Rpb24gd2hpY2ggYWxsb3dzIGZ1bGwgcmVjdXJzaXZlIGluY2x1ZGVcbiAgICB2YXIgcmV0dXJuZWRGbiA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICB2YXIgaW5jbHVkZSA9IGZ1bmN0aW9uIChwYXRoLCBpbmNsdWRlRGF0YSkge1xuICAgICAgICB2YXIgZCA9IHV0aWxzLnNoYWxsb3dDb3B5KHt9LCBkYXRhKTtcbiAgICAgICAgaWYgKGluY2x1ZGVEYXRhKSB7XG4gICAgICAgICAgZCA9IHV0aWxzLnNoYWxsb3dDb3B5KGQsIGluY2x1ZGVEYXRhKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaW5jbHVkZUZpbGUocGF0aCwgb3B0cykoZCk7XG4gICAgICB9O1xuICAgICAgcmV0dXJuIGZuLmFwcGx5KG9wdHMuY29udGV4dCwgW2RhdGEgfHwge30sIGVzY2FwZUZuLCBpbmNsdWRlLCByZXRocm93XSk7XG4gICAgfTtcbiAgICByZXR1cm5lZEZuLmRlcGVuZGVuY2llcyA9IHRoaXMuZGVwZW5kZW5jaWVzO1xuICAgIHJldHVybiByZXR1cm5lZEZuO1xuICB9LFxuXG4gIGdlbmVyYXRlU291cmNlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIG9wdHMgPSB0aGlzLm9wdHM7XG5cbiAgICBpZiAob3B0cy5ybVdoaXRlc3BhY2UpIHtcbiAgICAgIC8vIEhhdmUgdG8gdXNlIHR3byBzZXBhcmF0ZSByZXBsYWNlIGhlcmUgYXMgYF5gIGFuZCBgJGAgb3BlcmF0b3JzIGRvbid0XG4gICAgICAvLyB3b3JrIHdlbGwgd2l0aCBgXFxyYC5cbiAgICAgIHRoaXMudGVtcGxhdGVUZXh0ID1cbiAgICAgICAgdGhpcy50ZW1wbGF0ZVRleHQucmVwbGFjZSgvXFxyL2csICcnKS5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nbSwgJycpO1xuICAgIH1cblxuICAgIC8vIFNsdXJwIHNwYWNlcyBhbmQgdGFicyBiZWZvcmUgPCVfIGFuZCBhZnRlciBfJT5cbiAgICB0aGlzLnRlbXBsYXRlVGV4dCA9XG4gICAgICB0aGlzLnRlbXBsYXRlVGV4dC5yZXBsYWNlKC9bIFxcdF0qPCVfL2dtLCAnPCVfJykucmVwbGFjZSgvXyU+WyBcXHRdKi9nbSwgJ18lPicpO1xuXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBtYXRjaGVzID0gdGhpcy5wYXJzZVRlbXBsYXRlVGV4dCgpO1xuICAgIHZhciBkID0gdGhpcy5vcHRzLmRlbGltaXRlcjtcblxuICAgIGlmIChtYXRjaGVzICYmIG1hdGNoZXMubGVuZ3RoKSB7XG4gICAgICBtYXRjaGVzLmZvckVhY2goZnVuY3Rpb24gKGxpbmUsIGluZGV4KSB7XG4gICAgICAgIHZhciBvcGVuaW5nO1xuICAgICAgICB2YXIgY2xvc2luZztcbiAgICAgICAgdmFyIGluY2x1ZGU7XG4gICAgICAgIHZhciBpbmNsdWRlT3B0cztcbiAgICAgICAgdmFyIGluY2x1ZGVPYmo7XG4gICAgICAgIHZhciBpbmNsdWRlU3JjO1xuICAgICAgICAvLyBJZiB0aGlzIGlzIGFuIG9wZW5pbmcgdGFnLCBjaGVjayBmb3IgY2xvc2luZyB0YWdzXG4gICAgICAgIC8vIEZJWE1FOiBNYXkgZW5kIHVwIHdpdGggc29tZSBmYWxzZSBwb3NpdGl2ZXMgaGVyZVxuICAgICAgICAvLyBCZXR0ZXIgdG8gc3RvcmUgbW9kZXMgYXMgay92IHdpdGggJzwnICsgZGVsaW1pdGVyIGFzIGtleVxuICAgICAgICAvLyBUaGVuIHRoaXMgY2FuIHNpbXBseSBjaGVjayBhZ2FpbnN0IHRoZSBtYXBcbiAgICAgICAgaWYgKCBsaW5lLmluZGV4T2YoJzwnICsgZCkgPT09IDAgICAgICAgIC8vIElmIGl0IGlzIGEgdGFnXG4gICAgICAgICAgJiYgbGluZS5pbmRleE9mKCc8JyArIGQgKyBkKSAhPT0gMCkgeyAvLyBhbmQgaXMgbm90IGVzY2FwZWRcbiAgICAgICAgICBjbG9zaW5nID0gbWF0Y2hlc1tpbmRleCArIDJdO1xuICAgICAgICAgIGlmICghKGNsb3NpbmcgPT0gZCArICc+JyB8fCBjbG9zaW5nID09ICctJyArIGQgKyAnPicgfHwgY2xvc2luZyA9PSAnXycgKyBkICsgJz4nKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgZmluZCBtYXRjaGluZyBjbG9zZSB0YWcgZm9yIFwiJyArIGxpbmUgKyAnXCIuJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIEhBQ0s6IGJhY2t3YXJkLWNvbXBhdCBgaW5jbHVkZWAgcHJlcHJvY2Vzc29yIGRpcmVjdGl2ZXNcbiAgICAgICAgaWYgKChpbmNsdWRlID0gbGluZS5tYXRjaCgvXlxccyppbmNsdWRlXFxzKyhcXFMrKS8pKSkge1xuICAgICAgICAgIG9wZW5pbmcgPSBtYXRjaGVzW2luZGV4IC0gMV07XG4gICAgICAgICAgLy8gTXVzdCBiZSBpbiBFVkFMIG9yIFJBVyBtb2RlXG4gICAgICAgICAgaWYgKG9wZW5pbmcgJiYgKG9wZW5pbmcgPT0gJzwnICsgZCB8fCBvcGVuaW5nID09ICc8JyArIGQgKyAnLScgfHwgb3BlbmluZyA9PSAnPCcgKyBkICsgJ18nKSkge1xuICAgICAgICAgICAgaW5jbHVkZU9wdHMgPSB1dGlscy5zaGFsbG93Q29weSh7fSwgc2VsZi5vcHRzKTtcbiAgICAgICAgICAgIGluY2x1ZGVPYmogPSBpbmNsdWRlU291cmNlKGluY2x1ZGVbMV0sIGluY2x1ZGVPcHRzKTtcbiAgICAgICAgICAgIGlmIChzZWxmLm9wdHMuY29tcGlsZURlYnVnKSB7XG4gICAgICAgICAgICAgIGluY2x1ZGVTcmMgPVxuICAgICAgICAgICAgICAgICAgJyAgICA7IChmdW5jdGlvbigpeycgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyAnICAgICAgdmFyIF9fbGluZSA9IDEnICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgJyAgICAgICwgX19saW5lcyA9ICcgKyBKU09OLnN0cmluZ2lmeShpbmNsdWRlT2JqLnRlbXBsYXRlKSArICdcXG4nXG4gICAgICAgICAgICAgICAgICArICcgICAgICAsIF9fZmlsZW5hbWUgPSAnICsgSlNPTi5zdHJpbmdpZnkoaW5jbHVkZU9iai5maWxlbmFtZSkgKyAnOycgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyAnICAgICAgdHJ5IHsnICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgaW5jbHVkZU9iai5zb3VyY2VcbiAgICAgICAgICAgICAgICAgICsgJyAgICAgIH0gY2F0Y2ggKGUpIHsnICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgJyAgICAgICAgcmV0aHJvdyhlLCBfX2xpbmVzLCBfX2ZpbGVuYW1lLCBfX2xpbmUsIGVzY2FwZUZuKTsnICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgJyAgICAgIH0nICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgJyAgICA7IH0pLmNhbGwodGhpcyknICsgJ1xcbic7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgaW5jbHVkZVNyYyA9ICcgICAgOyAoZnVuY3Rpb24oKXsnICsgJ1xcbicgKyBpbmNsdWRlT2JqLnNvdXJjZSArXG4gICAgICAgICAgICAgICAgICAnICAgIDsgfSkuY2FsbCh0aGlzKScgKyAnXFxuJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGYuc291cmNlICs9IGluY2x1ZGVTcmM7XG4gICAgICAgICAgICBzZWxmLmRlcGVuZGVuY2llcy5wdXNoKGV4cG9ydHMucmVzb2x2ZUluY2x1ZGUoaW5jbHVkZVsxXSxcbiAgICAgICAgICAgICAgaW5jbHVkZU9wdHMuZmlsZW5hbWUpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc2VsZi5zY2FuTGluZShsaW5lKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICB9LFxuXG4gIHBhcnNlVGVtcGxhdGVUZXh0OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHN0ciA9IHRoaXMudGVtcGxhdGVUZXh0O1xuICAgIHZhciBwYXQgPSB0aGlzLnJlZ2V4O1xuICAgIHZhciByZXN1bHQgPSBwYXQuZXhlYyhzdHIpO1xuICAgIHZhciBhcnIgPSBbXTtcbiAgICB2YXIgZmlyc3RQb3M7XG5cbiAgICB3aGlsZSAocmVzdWx0KSB7XG4gICAgICBmaXJzdFBvcyA9IHJlc3VsdC5pbmRleDtcblxuICAgICAgaWYgKGZpcnN0UG9zICE9PSAwKSB7XG4gICAgICAgIGFyci5wdXNoKHN0ci5zdWJzdHJpbmcoMCwgZmlyc3RQb3MpKTtcbiAgICAgICAgc3RyID0gc3RyLnNsaWNlKGZpcnN0UG9zKTtcbiAgICAgIH1cblxuICAgICAgYXJyLnB1c2gocmVzdWx0WzBdKTtcbiAgICAgIHN0ciA9IHN0ci5zbGljZShyZXN1bHRbMF0ubGVuZ3RoKTtcbiAgICAgIHJlc3VsdCA9IHBhdC5leGVjKHN0cik7XG4gICAgfVxuXG4gICAgaWYgKHN0cikge1xuICAgICAgYXJyLnB1c2goc3RyKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXJyO1xuICB9LFxuXG4gIF9hZGRPdXRwdXQ6IGZ1bmN0aW9uIChsaW5lKSB7XG4gICAgaWYgKHRoaXMudHJ1bmNhdGUpIHtcbiAgICAgIC8vIE9ubHkgcmVwbGFjZSBzaW5nbGUgbGVhZGluZyBsaW5lYnJlYWsgaW4gdGhlIGxpbmUgYWZ0ZXJcbiAgICAgIC8vIC0lPiB0YWcgLS0gdGhpcyBpcyB0aGUgc2luZ2xlLCB0cmFpbGluZyBsaW5lYnJlYWtcbiAgICAgIC8vIGFmdGVyIHRoZSB0YWcgdGhhdCB0aGUgdHJ1bmNhdGlvbiBtb2RlIHJlcGxhY2VzXG4gICAgICAvLyBIYW5kbGUgV2luIC8gVW5peCAvIG9sZCBNYWMgbGluZWJyZWFrcyAtLSBkbyB0aGUgXFxyXFxuXG4gICAgICAvLyBjb21ibyBmaXJzdCBpbiB0aGUgcmVnZXgtb3JcbiAgICAgIGxpbmUgPSBsaW5lLnJlcGxhY2UoL14oPzpcXHJcXG58XFxyfFxcbikvLCAnJyk7XG4gICAgICB0aGlzLnRydW5jYXRlID0gZmFsc2U7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMub3B0cy5ybVdoaXRlc3BhY2UpIHtcbiAgICAgIC8vIHJtV2hpdGVzcGFjZSBoYXMgYWxyZWFkeSByZW1vdmVkIHRyYWlsaW5nIHNwYWNlcywganVzdCBuZWVkXG4gICAgICAvLyB0byByZW1vdmUgbGluZWJyZWFrc1xuICAgICAgbGluZSA9IGxpbmUucmVwbGFjZSgvXlxcbi8sICcnKTtcbiAgICB9XG4gICAgaWYgKCFsaW5lKSB7XG4gICAgICByZXR1cm4gbGluZTtcbiAgICB9XG5cbiAgICAvLyBQcmVzZXJ2ZSBsaXRlcmFsIHNsYXNoZXNcbiAgICBsaW5lID0gbGluZS5yZXBsYWNlKC9cXFxcL2csICdcXFxcXFxcXCcpO1xuXG4gICAgLy8gQ29udmVydCBsaW5lYnJlYWtzXG4gICAgbGluZSA9IGxpbmUucmVwbGFjZSgvXFxuL2csICdcXFxcbicpO1xuICAgIGxpbmUgPSBsaW5lLnJlcGxhY2UoL1xcci9nLCAnXFxcXHInKTtcblxuICAgIC8vIEVzY2FwZSBkb3VibGUtcXVvdGVzXG4gICAgLy8gLSB0aGlzIHdpbGwgYmUgdGhlIGRlbGltaXRlciBkdXJpbmcgZXhlY3V0aW9uXG4gICAgbGluZSA9IGxpbmUucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpO1xuICAgIHRoaXMuc291cmNlICs9ICcgICAgOyBfX2FwcGVuZChcIicgKyBsaW5lICsgJ1wiKScgKyAnXFxuJztcbiAgfSxcblxuICBzY2FuTGluZTogZnVuY3Rpb24gKGxpbmUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGQgPSB0aGlzLm9wdHMuZGVsaW1pdGVyO1xuICAgIHZhciBuZXdMaW5lQ291bnQgPSAwO1xuXG4gICAgbmV3TGluZUNvdW50ID0gKGxpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aCAtIDEpO1xuXG4gICAgc3dpdGNoIChsaW5lKSB7XG4gICAgY2FzZSAnPCcgKyBkOlxuICAgIGNhc2UgJzwnICsgZCArICdfJzpcbiAgICAgIHRoaXMubW9kZSA9IFRlbXBsYXRlLm1vZGVzLkVWQUw7XG4gICAgICBicmVhaztcbiAgICBjYXNlICc8JyArIGQgKyAnPSc6XG4gICAgICB0aGlzLm1vZGUgPSBUZW1wbGF0ZS5tb2Rlcy5FU0NBUEVEO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnPCcgKyBkICsgJy0nOlxuICAgICAgdGhpcy5tb2RlID0gVGVtcGxhdGUubW9kZXMuUkFXO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnPCcgKyBkICsgJyMnOlxuICAgICAgdGhpcy5tb2RlID0gVGVtcGxhdGUubW9kZXMuQ09NTUVOVDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJzwnICsgZCArIGQ6XG4gICAgICB0aGlzLm1vZGUgPSBUZW1wbGF0ZS5tb2Rlcy5MSVRFUkFMO1xuICAgICAgdGhpcy5zb3VyY2UgKz0gJyAgICA7IF9fYXBwZW5kKFwiJyArIGxpbmUucmVwbGFjZSgnPCcgKyBkICsgZCwgJzwnICsgZCkgKyAnXCIpJyArICdcXG4nO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSBkICsgZCArICc+JzpcbiAgICAgIHRoaXMubW9kZSA9IFRlbXBsYXRlLm1vZGVzLkxJVEVSQUw7XG4gICAgICB0aGlzLnNvdXJjZSArPSAnICAgIDsgX19hcHBlbmQoXCInICsgbGluZS5yZXBsYWNlKGQgKyBkICsgJz4nLCBkICsgJz4nKSArICdcIiknICsgJ1xcbic7XG4gICAgICBicmVhaztcbiAgICBjYXNlIGQgKyAnPic6XG4gICAgY2FzZSAnLScgKyBkICsgJz4nOlxuICAgIGNhc2UgJ18nICsgZCArICc+JzpcbiAgICAgIGlmICh0aGlzLm1vZGUgPT0gVGVtcGxhdGUubW9kZXMuTElURVJBTCkge1xuICAgICAgICB0aGlzLl9hZGRPdXRwdXQobGluZSk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMubW9kZSA9IG51bGw7XG4gICAgICB0aGlzLnRydW5jYXRlID0gbGluZS5pbmRleE9mKCctJykgPT09IDAgfHwgbGluZS5pbmRleE9mKCdfJykgPT09IDA7XG4gICAgICBicmVhaztcbiAgICBkZWZhdWx0OlxuICAgICAgLy8gSW4gc2NyaXB0IG1vZGUsIGRlcGVuZHMgb24gdHlwZSBvZiB0YWdcbiAgICAgIGlmICh0aGlzLm1vZGUpIHtcbiAgICAgICAgLy8gSWYgJy8vJyBpcyBmb3VuZCB3aXRob3V0IGEgbGluZSBicmVhaywgYWRkIGEgbGluZSBicmVhay5cbiAgICAgICAgc3dpdGNoICh0aGlzLm1vZGUpIHtcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5FVkFMOlxuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLkVTQ0FQRUQ6XG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuUkFXOlxuICAgICAgICAgIGlmIChsaW5lLmxhc3RJbmRleE9mKCcvLycpID4gbGluZS5sYXN0SW5kZXhPZignXFxuJykpIHtcbiAgICAgICAgICAgIGxpbmUgKz0gJ1xcbic7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHN3aXRjaCAodGhpcy5tb2RlKSB7XG4gICAgICAgIC8vIEp1c3QgZXhlY3V0aW5nIGNvZGVcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5FVkFMOlxuICAgICAgICAgIHRoaXMuc291cmNlICs9ICcgICAgOyAnICsgbGluZSArICdcXG4nO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIC8vIEV4ZWMsIGVzYywgYW5kIG91dHB1dFxuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLkVTQ0FQRUQ6XG4gICAgICAgICAgdGhpcy5zb3VyY2UgKz0gJyAgICA7IF9fYXBwZW5kKGVzY2FwZUZuKCcgKyBzdHJpcFNlbWkobGluZSkgKyAnKSknICsgJ1xcbic7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgLy8gRXhlYyBhbmQgb3V0cHV0XG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuUkFXOlxuICAgICAgICAgIHRoaXMuc291cmNlICs9ICcgICAgOyBfX2FwcGVuZCgnICsgc3RyaXBTZW1pKGxpbmUpICsgJyknICsgJ1xcbic7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuQ09NTUVOVDpcbiAgICAgICAgICAvLyBEbyBub3RoaW5nXG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgLy8gTGl0ZXJhbCA8JSUgbW9kZSwgYXBwZW5kIGFzIHJhdyBvdXRwdXRcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5MSVRFUkFMOlxuICAgICAgICAgIHRoaXMuX2FkZE91dHB1dChsaW5lKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gSW4gc3RyaW5nIG1vZGUsIGp1c3QgYWRkIHRoZSBvdXRwdXRcbiAgICAgIGVsc2Uge1xuICAgICAgICB0aGlzLl9hZGRPdXRwdXQobGluZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNlbGYub3B0cy5jb21waWxlRGVidWcgJiYgbmV3TGluZUNvdW50KSB7XG4gICAgICB0aGlzLmN1cnJlbnRMaW5lICs9IG5ld0xpbmVDb3VudDtcbiAgICAgIHRoaXMuc291cmNlICs9ICcgICAgOyBfX2xpbmUgPSAnICsgdGhpcy5jdXJyZW50TGluZSArICdcXG4nO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBFc2NhcGUgY2hhcmFjdGVycyByZXNlcnZlZCBpbiBYTUwuXG4gKlxuICogVGhpcyBpcyBzaW1wbHkgYW4gZXhwb3J0IG9mIHtAbGluayBtb2R1bGU6dXRpbHMuZXNjYXBlWE1MfS5cbiAqXG4gKiBJZiBgbWFya3VwYCBpcyBgdW5kZWZpbmVkYCBvciBgbnVsbGAsIHRoZSBlbXB0eSBzdHJpbmcgaXMgcmV0dXJuZWQuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG1hcmt1cCBJbnB1dCBzdHJpbmdcbiAqIEByZXR1cm4ge1N0cmluZ30gRXNjYXBlZCBzdHJpbmdcbiAqIEBwdWJsaWNcbiAqIEBmdW5jXG4gKiAqL1xuZXhwb3J0cy5lc2NhcGVYTUwgPSB1dGlscy5lc2NhcGVYTUw7XG5cbi8qKlxuICogRXhwcmVzcy5qcyBzdXBwb3J0LlxuICpcbiAqIFRoaXMgaXMgYW4gYWxpYXMgZm9yIHtAbGluayBtb2R1bGU6ZWpzLnJlbmRlckZpbGV9LCBpbiBvcmRlciB0byBzdXBwb3J0XG4gKiBFeHByZXNzLmpzIG91dC1vZi10aGUtYm94LlxuICpcbiAqIEBmdW5jXG4gKi9cblxuZXhwb3J0cy5fX2V4cHJlc3MgPSBleHBvcnRzLnJlbmRlckZpbGU7XG5cbi8vIEFkZCByZXF1aXJlIHN1cHBvcnRcbi8qIGlzdGFuYnVsIGlnbm9yZSBlbHNlICovXG5pZiAocmVxdWlyZS5leHRlbnNpb25zKSB7XG4gIHJlcXVpcmUuZXh0ZW5zaW9uc1snLmVqcyddID0gZnVuY3Rpb24gKG1vZHVsZSwgZmxubSkge1xuICAgIHZhciBmaWxlbmFtZSA9IGZsbm0gfHwgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi8gbW9kdWxlLmZpbGVuYW1lO1xuICAgIHZhciBvcHRpb25zID0ge1xuICAgICAgZmlsZW5hbWU6IGZpbGVuYW1lLFxuICAgICAgY2xpZW50OiB0cnVlXG4gICAgfTtcbiAgICB2YXIgdGVtcGxhdGUgPSBmaWxlTG9hZGVyKGZpbGVuYW1lKS50b1N0cmluZygpO1xuICAgIHZhciBmbiA9IGV4cG9ydHMuY29tcGlsZSh0ZW1wbGF0ZSwgb3B0aW9ucyk7XG4gICAgbW9kdWxlLl9jb21waWxlKCdtb2R1bGUuZXhwb3J0cyA9ICcgKyBmbi50b1N0cmluZygpICsgJzsnLCBmaWxlbmFtZSk7XG4gIH07XG59XG5cbi8qKlxuICogVmVyc2lvbiBvZiBFSlMuXG4gKlxuICogQHJlYWRvbmx5XG4gKiBAdHlwZSB7U3RyaW5nfVxuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMuVkVSU0lPTiA9IF9WRVJTSU9OX1NUUklORztcblxuLyoqXG4gKiBOYW1lIGZvciBkZXRlY3Rpb24gb2YgRUpTLlxuICpcbiAqIEByZWFkb25seVxuICogQHR5cGUge1N0cmluZ31cbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLm5hbWUgPSBfTkFNRTtcblxuLyogaXN0YW5idWwgaWdub3JlIGlmICovXG5pZiAodHlwZW9mIHdpbmRvdyAhPSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuZWpzID0gZXhwb3J0cztcbn1cbiIsIi8qXG4gKiBFSlMgRW1iZWRkZWQgSmF2YVNjcmlwdCB0ZW1wbGF0ZXNcbiAqIENvcHlyaWdodCAyMTEyIE1hdHRoZXcgRWVybmlzc2UgKG1kZUBmbGVlZ2l4Lm9yZylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICpcbiovXG5cbi8qKlxuICogUHJpdmF0ZSB1dGlsaXR5IGZ1bmN0aW9uc1xuICogQG1vZHVsZSB1dGlsc1xuICogQHByaXZhdGVcbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciByZWdFeHBDaGFycyA9IC9bfFxcXFx7fSgpW1xcXV4kKyo/Ll0vZztcblxuLyoqXG4gKiBFc2NhcGUgY2hhcmFjdGVycyByZXNlcnZlZCBpbiByZWd1bGFyIGV4cHJlc3Npb25zLlxuICpcbiAqIElmIGBzdHJpbmdgIGlzIGB1bmRlZmluZWRgIG9yIGBudWxsYCwgdGhlIGVtcHR5IHN0cmluZyBpcyByZXR1cm5lZC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyaW5nIElucHV0IHN0cmluZ1xuICogQHJldHVybiB7U3RyaW5nfSBFc2NhcGVkIHN0cmluZ1xuICogQHN0YXRpY1xuICogQHByaXZhdGVcbiAqL1xuZXhwb3J0cy5lc2NhcGVSZWdFeHBDaGFycyA9IGZ1bmN0aW9uIChzdHJpbmcpIHtcbiAgLy8gaXN0YW5idWwgaWdub3JlIGlmXG4gIGlmICghc3RyaW5nKSB7XG4gICAgcmV0dXJuICcnO1xuICB9XG4gIHJldHVybiBTdHJpbmcoc3RyaW5nKS5yZXBsYWNlKHJlZ0V4cENoYXJzLCAnXFxcXCQmJyk7XG59O1xuXG52YXIgX0VOQ09ERV9IVE1MX1JVTEVTID0ge1xuICAnJic6ICcmYW1wOycsXG4gICc8JzogJyZsdDsnLFxuICAnPic6ICcmZ3Q7JyxcbiAgJ1wiJzogJyYjMzQ7JyxcbiAgXCInXCI6ICcmIzM5Oydcbn07XG52YXIgX01BVENIX0hUTUwgPSAvWyY8PidcIl0vZztcblxuZnVuY3Rpb24gZW5jb2RlX2NoYXIoYykge1xuICByZXR1cm4gX0VOQ09ERV9IVE1MX1JVTEVTW2NdIHx8IGM7XG59XG5cbi8qKlxuICogU3RyaW5naWZpZWQgdmVyc2lvbiBvZiBjb25zdGFudHMgdXNlZCBieSB7QGxpbmsgbW9kdWxlOnV0aWxzLmVzY2FwZVhNTH0uXG4gKlxuICogSXQgaXMgdXNlZCBpbiB0aGUgcHJvY2VzcyBvZiBnZW5lcmF0aW5nIHtAbGluayBDbGllbnRGdW5jdGlvbn1zLlxuICpcbiAqIEByZWFkb25seVxuICogQHR5cGUge1N0cmluZ31cbiAqL1xuXG52YXIgZXNjYXBlRnVuY1N0ciA9XG4gICd2YXIgX0VOQ09ERV9IVE1MX1JVTEVTID0ge1xcbidcbisgJyAgICAgIFwiJlwiOiBcIiZhbXA7XCJcXG4nXG4rICcgICAgLCBcIjxcIjogXCImbHQ7XCJcXG4nXG4rICcgICAgLCBcIj5cIjogXCImZ3Q7XCJcXG4nXG4rICcgICAgLCBcXCdcIlxcJzogXCImIzM0O1wiXFxuJ1xuKyAnICAgICwgXCJcXCdcIjogXCImIzM5O1wiXFxuJ1xuKyAnICAgIH1cXG4nXG4rICcgICwgX01BVENIX0hUTUwgPSAvWyY8PlxcJ1wiXS9nO1xcbidcbisgJ2Z1bmN0aW9uIGVuY29kZV9jaGFyKGMpIHtcXG4nXG4rICcgIHJldHVybiBfRU5DT0RFX0hUTUxfUlVMRVNbY10gfHwgYztcXG4nXG4rICd9O1xcbic7XG5cbi8qKlxuICogRXNjYXBlIGNoYXJhY3RlcnMgcmVzZXJ2ZWQgaW4gWE1MLlxuICpcbiAqIElmIGBtYXJrdXBgIGlzIGB1bmRlZmluZWRgIG9yIGBudWxsYCwgdGhlIGVtcHR5IHN0cmluZyBpcyByZXR1cm5lZC5cbiAqXG4gKiBAaW1wbGVtZW50cyB7RXNjYXBlQ2FsbGJhY2t9XG4gKiBAcGFyYW0ge1N0cmluZ30gbWFya3VwIElucHV0IHN0cmluZ1xuICogQHJldHVybiB7U3RyaW5nfSBFc2NhcGVkIHN0cmluZ1xuICogQHN0YXRpY1xuICogQHByaXZhdGVcbiAqL1xuXG5leHBvcnRzLmVzY2FwZVhNTCA9IGZ1bmN0aW9uIChtYXJrdXApIHtcbiAgcmV0dXJuIG1hcmt1cCA9PSB1bmRlZmluZWRcbiAgICA/ICcnXG4gICAgOiBTdHJpbmcobWFya3VwKVxuICAgICAgLnJlcGxhY2UoX01BVENIX0hUTUwsIGVuY29kZV9jaGFyKTtcbn07XG5leHBvcnRzLmVzY2FwZVhNTC50b1N0cmluZyA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIEZ1bmN0aW9uLnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHRoaXMpICsgJztcXG4nICsgZXNjYXBlRnVuY1N0cjtcbn07XG5cbi8qKlxuICogTmFpdmUgY29weSBvZiBwcm9wZXJ0aWVzIGZyb20gb25lIG9iamVjdCB0byBhbm90aGVyLlxuICogRG9lcyBub3QgcmVjdXJzZSBpbnRvIG5vbi1zY2FsYXIgcHJvcGVydGllc1xuICogRG9lcyBub3QgY2hlY2sgdG8gc2VlIGlmIHRoZSBwcm9wZXJ0eSBoYXMgYSB2YWx1ZSBiZWZvcmUgY29weWluZ1xuICpcbiAqIEBwYXJhbSAge09iamVjdH0gdG8gICBEZXN0aW5hdGlvbiBvYmplY3RcbiAqIEBwYXJhbSAge09iamVjdH0gZnJvbSBTb3VyY2Ugb2JqZWN0XG4gKiBAcmV0dXJuIHtPYmplY3R9ICAgICAgRGVzdGluYXRpb24gb2JqZWN0XG4gKiBAc3RhdGljXG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnRzLnNoYWxsb3dDb3B5ID0gZnVuY3Rpb24gKHRvLCBmcm9tKSB7XG4gIGZyb20gPSBmcm9tIHx8IHt9O1xuICBmb3IgKHZhciBwIGluIGZyb20pIHtcbiAgICB0b1twXSA9IGZyb21bcF07XG4gIH1cbiAgcmV0dXJuIHRvO1xufTtcblxuLyoqXG4gKiBOYWl2ZSBjb3B5IG9mIGEgbGlzdCBvZiBrZXkgbmFtZXMsIGZyb20gb25lIG9iamVjdCB0byBhbm90aGVyLlxuICogT25seSBjb3BpZXMgcHJvcGVydHkgaWYgaXQgaXMgYWN0dWFsbHkgZGVmaW5lZFxuICogRG9lcyBub3QgcmVjdXJzZSBpbnRvIG5vbi1zY2FsYXIgcHJvcGVydGllc1xuICpcbiAqIEBwYXJhbSAge09iamVjdH0gdG8gICBEZXN0aW5hdGlvbiBvYmplY3RcbiAqIEBwYXJhbSAge09iamVjdH0gZnJvbSBTb3VyY2Ugb2JqZWN0XG4gKiBAcGFyYW0gIHtBcnJheX0gbGlzdCBMaXN0IG9mIHByb3BlcnRpZXMgdG8gY29weVxuICogQHJldHVybiB7T2JqZWN0fSAgICAgIERlc3RpbmF0aW9uIG9iamVjdFxuICogQHN0YXRpY1xuICogQHByaXZhdGVcbiAqL1xuZXhwb3J0cy5zaGFsbG93Q29weUZyb21MaXN0ID0gZnVuY3Rpb24gKHRvLCBmcm9tLCBsaXN0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwID0gbGlzdFtpXTtcbiAgICBpZiAodHlwZW9mIGZyb21bcF0gIT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRvW3BdID0gZnJvbVtwXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRvO1xufTtcblxuLyoqXG4gKiBTaW1wbGUgaW4tcHJvY2VzcyBjYWNoZSBpbXBsZW1lbnRhdGlvbi4gRG9lcyBub3QgaW1wbGVtZW50IGxpbWl0cyBvZiBhbnlcbiAqIHNvcnQuXG4gKlxuICogQGltcGxlbWVudHMgQ2FjaGVcbiAqIEBzdGF0aWNcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydHMuY2FjaGUgPSB7XG4gIF9kYXRhOiB7fSxcbiAgc2V0OiBmdW5jdGlvbiAoa2V5LCB2YWwpIHtcbiAgICB0aGlzLl9kYXRhW2tleV0gPSB2YWw7XG4gIH0sXG4gIGdldDogZnVuY3Rpb24gKGtleSkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhW2tleV07XG4gIH0sXG4gIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5fZGF0YSA9IHt9O1xuICB9XG59O1xuIiwibW9kdWxlLmV4cG9ydHM9e1xuICBcIl9mcm9tXCI6IFwiZWpzXCIsXG4gIFwiX2lkXCI6IFwiZWpzQDIuNi4xXCIsXG4gIFwiX2luQnVuZGxlXCI6IGZhbHNlLFxuICBcIl9pbnRlZ3JpdHlcIjogXCJzaGE1MTItMHh5NEEvdHdmclJDbmtoZms4RXJEaTVEcWRBc0FxZUd4aHQ0eGtDVXJzdmhoYlFOczdFKzRqVjBDTjcrTktJWTBhSEU3MitYdnF0QklYekQzMVpiWFE9PVwiLFxuICBcIl9sb2NhdGlvblwiOiBcIi9lanNcIixcbiAgXCJfcGhhbnRvbUNoaWxkcmVuXCI6IHt9LFxuICBcIl9yZXF1ZXN0ZWRcIjoge1xuICAgIFwidHlwZVwiOiBcInRhZ1wiLFxuICAgIFwicmVnaXN0cnlcIjogdHJ1ZSxcbiAgICBcInJhd1wiOiBcImVqc1wiLFxuICAgIFwibmFtZVwiOiBcImVqc1wiLFxuICAgIFwiZXNjYXBlZE5hbWVcIjogXCJlanNcIixcbiAgICBcInJhd1NwZWNcIjogXCJcIixcbiAgICBcInNhdmVTcGVjXCI6IG51bGwsXG4gICAgXCJmZXRjaFNwZWNcIjogXCJsYXRlc3RcIlxuICB9LFxuICBcIl9yZXF1aXJlZEJ5XCI6IFtcbiAgICBcIiNERVY6L1wiLFxuICAgIFwiI1VTRVJcIlxuICBdLFxuICBcIl9yZXNvbHZlZFwiOiBcImh0dHBzOi8vcmVnaXN0cnkubnBtanMub3JnL2Vqcy8tL2Vqcy0yLjYuMS50Z3pcIixcbiAgXCJfc2hhc3VtXCI6IFwiNDk4ZWMwZDQ5NTY1NWFiYzZmMjNjZDYxODY4ZDkyNjQ2NDA3MWFhMFwiLFxuICBcIl9zcGVjXCI6IFwiZWpzXCIsXG4gIFwiX3doZXJlXCI6IFwiL3Zhci93d3cvaHRtbC9oaXQyMzgvZm9vZHZhbnNcIixcbiAgXCJhdXRob3JcIjoge1xuICAgIFwibmFtZVwiOiBcIk1hdHRoZXcgRWVybmlzc2VcIixcbiAgICBcImVtYWlsXCI6IFwibWRlQGZsZWVnaXgub3JnXCIsXG4gICAgXCJ1cmxcIjogXCJodHRwOi8vZmxlZWdpeC5vcmdcIlxuICB9LFxuICBcImJ1Z3NcIjoge1xuICAgIFwidXJsXCI6IFwiaHR0cHM6Ly9naXRodWIuY29tL21kZS9lanMvaXNzdWVzXCJcbiAgfSxcbiAgXCJidW5kbGVEZXBlbmRlbmNpZXNcIjogZmFsc2UsXG4gIFwiY29udHJpYnV0b3JzXCI6IFtcbiAgICB7XG4gICAgICBcIm5hbWVcIjogXCJUaW1vdGh5IEd1XCIsXG4gICAgICBcImVtYWlsXCI6IFwidGltb3RoeWd1OTlAZ21haWwuY29tXCIsXG4gICAgICBcInVybFwiOiBcImh0dHBzOi8vdGltb3RoeWd1LmdpdGh1Yi5pb1wiXG4gICAgfVxuICBdLFxuICBcImRlcGVuZGVuY2llc1wiOiB7fSxcbiAgXCJkZXByZWNhdGVkXCI6IGZhbHNlLFxuICBcImRlc2NyaXB0aW9uXCI6IFwiRW1iZWRkZWQgSmF2YVNjcmlwdCB0ZW1wbGF0ZXNcIixcbiAgXCJkZXZEZXBlbmRlbmNpZXNcIjoge1xuICAgIFwiYnJvd3NlcmlmeVwiOiBcIl4xMy4xLjFcIixcbiAgICBcImVzbGludFwiOiBcIl40LjE0LjBcIixcbiAgICBcImdpdC1kaXJlY3RvcnktZGVwbG95XCI6IFwiXjEuNS4xXCIsXG4gICAgXCJpc3RhbmJ1bFwiOiBcIn4wLjQuM1wiLFxuICAgIFwiamFrZVwiOiBcIl44LjAuMTZcIixcbiAgICBcImpzZG9jXCI6IFwiXjMuNC4wXCIsXG4gICAgXCJscnUtY2FjaGVcIjogXCJeNC4wLjFcIixcbiAgICBcIm1vY2hhXCI6IFwiXjUuMC41XCIsXG4gICAgXCJ1Z2xpZnktanNcIjogXCJeMy4zLjE2XCJcbiAgfSxcbiAgXCJlbmdpbmVzXCI6IHtcbiAgICBcIm5vZGVcIjogXCI+PTAuMTAuMFwiXG4gIH0sXG4gIFwiaG9tZXBhZ2VcIjogXCJodHRwczovL2dpdGh1Yi5jb20vbWRlL2Vqc1wiLFxuICBcImtleXdvcmRzXCI6IFtcbiAgICBcInRlbXBsYXRlXCIsXG4gICAgXCJlbmdpbmVcIixcbiAgICBcImVqc1wiXG4gIF0sXG4gIFwibGljZW5zZVwiOiBcIkFwYWNoZS0yLjBcIixcbiAgXCJtYWluXCI6IFwiLi9saWIvZWpzLmpzXCIsXG4gIFwibmFtZVwiOiBcImVqc1wiLFxuICBcInJlcG9zaXRvcnlcIjoge1xuICAgIFwidHlwZVwiOiBcImdpdFwiLFxuICAgIFwidXJsXCI6IFwiZ2l0Oi8vZ2l0aHViLmNvbS9tZGUvZWpzLmdpdFwiXG4gIH0sXG4gIFwic2NyaXB0c1wiOiB7XG4gICAgXCJjb3ZlcmFnZVwiOiBcImlzdGFuYnVsIGNvdmVyIG5vZGVfbW9kdWxlcy9tb2NoYS9iaW4vX21vY2hhXCIsXG4gICAgXCJkZXZkb2NcIjogXCJqYWtlIGRvY1tkZXZdXCIsXG4gICAgXCJkb2NcIjogXCJqYWtlIGRvY1wiLFxuICAgIFwibGludFwiOiBcImVzbGludCBcXFwiKiovKi5qc1xcXCIgSmFrZWZpbGVcIixcbiAgICBcInRlc3RcIjogXCJqYWtlIHRlc3RcIlxuICB9LFxuICBcInZlcnNpb25cIjogXCIyLjYuMVwiXG59XG4iLCIvLyAuZGlybmFtZSwgLmJhc2VuYW1lLCBhbmQgLmV4dG5hbWUgbWV0aG9kcyBhcmUgZXh0cmFjdGVkIGZyb20gTm9kZS5qcyB2OC4xMS4xLFxuLy8gYmFja3BvcnRlZCBhbmQgdHJhbnNwbGl0ZWQgd2l0aCBCYWJlbCwgd2l0aCBiYWNrd2FyZHMtY29tcGF0IGZpeGVzXG5cbi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4vLyByZXNvbHZlcyAuIGFuZCAuLiBlbGVtZW50cyBpbiBhIHBhdGggYXJyYXkgd2l0aCBkaXJlY3RvcnkgbmFtZXMgdGhlcmVcbi8vIG11c3QgYmUgbm8gc2xhc2hlcywgZW1wdHkgZWxlbWVudHMsIG9yIGRldmljZSBuYW1lcyAoYzpcXCkgaW4gdGhlIGFycmF5XG4vLyAoc28gYWxzbyBubyBsZWFkaW5nIGFuZCB0cmFpbGluZyBzbGFzaGVzIC0gaXQgZG9lcyBub3QgZGlzdGluZ3Vpc2hcbi8vIHJlbGF0aXZlIGFuZCBhYnNvbHV0ZSBwYXRocylcbmZ1bmN0aW9uIG5vcm1hbGl6ZUFycmF5KHBhcnRzLCBhbGxvd0Fib3ZlUm9vdCkge1xuICAvLyBpZiB0aGUgcGF0aCB0cmllcyB0byBnbyBhYm92ZSB0aGUgcm9vdCwgYHVwYCBlbmRzIHVwID4gMFxuICB2YXIgdXAgPSAwO1xuICBmb3IgKHZhciBpID0gcGFydHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICB2YXIgbGFzdCA9IHBhcnRzW2ldO1xuICAgIGlmIChsYXN0ID09PSAnLicpIHtcbiAgICAgIHBhcnRzLnNwbGljZShpLCAxKTtcbiAgICB9IGVsc2UgaWYgKGxhc3QgPT09ICcuLicpIHtcbiAgICAgIHBhcnRzLnNwbGljZShpLCAxKTtcbiAgICAgIHVwKys7XG4gICAgfSBlbHNlIGlmICh1cCkge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgICAgdXAtLTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiB0aGUgcGF0aCBpcyBhbGxvd2VkIHRvIGdvIGFib3ZlIHRoZSByb290LCByZXN0b3JlIGxlYWRpbmcgLi5zXG4gIGlmIChhbGxvd0Fib3ZlUm9vdCkge1xuICAgIGZvciAoOyB1cC0tOyB1cCkge1xuICAgICAgcGFydHMudW5zaGlmdCgnLi4nKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG5cbi8vIHBhdGgucmVzb2x2ZShbZnJvbSAuLi5dLCB0bylcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMucmVzb2x2ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcmVzb2x2ZWRQYXRoID0gJycsXG4gICAgICByZXNvbHZlZEFic29sdXRlID0gZmFsc2U7XG5cbiAgZm9yICh2YXIgaSA9IGFyZ3VtZW50cy5sZW5ndGggLSAxOyBpID49IC0xICYmICFyZXNvbHZlZEFic29sdXRlOyBpLS0pIHtcbiAgICB2YXIgcGF0aCA9IChpID49IDApID8gYXJndW1lbnRzW2ldIDogcHJvY2Vzcy5jd2QoKTtcblxuICAgIC8vIFNraXAgZW1wdHkgYW5kIGludmFsaWQgZW50cmllc1xuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyB0byBwYXRoLnJlc29sdmUgbXVzdCBiZSBzdHJpbmdzJyk7XG4gICAgfSBlbHNlIGlmICghcGF0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgcmVzb2x2ZWRQYXRoID0gcGF0aCArICcvJyArIHJlc29sdmVkUGF0aDtcbiAgICByZXNvbHZlZEFic29sdXRlID0gcGF0aC5jaGFyQXQoMCkgPT09ICcvJztcbiAgfVxuXG4gIC8vIEF0IHRoaXMgcG9pbnQgdGhlIHBhdGggc2hvdWxkIGJlIHJlc29sdmVkIHRvIGEgZnVsbCBhYnNvbHV0ZSBwYXRoLCBidXRcbiAgLy8gaGFuZGxlIHJlbGF0aXZlIHBhdGhzIHRvIGJlIHNhZmUgKG1pZ2h0IGhhcHBlbiB3aGVuIHByb2Nlc3MuY3dkKCkgZmFpbHMpXG5cbiAgLy8gTm9ybWFsaXplIHRoZSBwYXRoXG4gIHJlc29sdmVkUGF0aCA9IG5vcm1hbGl6ZUFycmF5KGZpbHRlcihyZXNvbHZlZFBhdGguc3BsaXQoJy8nKSwgZnVuY3Rpb24ocCkge1xuICAgIHJldHVybiAhIXA7XG4gIH0pLCAhcmVzb2x2ZWRBYnNvbHV0ZSkuam9pbignLycpO1xuXG4gIHJldHVybiAoKHJlc29sdmVkQWJzb2x1dGUgPyAnLycgOiAnJykgKyByZXNvbHZlZFBhdGgpIHx8ICcuJztcbn07XG5cbi8vIHBhdGgubm9ybWFsaXplKHBhdGgpXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLm5vcm1hbGl6ZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgdmFyIGlzQWJzb2x1dGUgPSBleHBvcnRzLmlzQWJzb2x1dGUocGF0aCksXG4gICAgICB0cmFpbGluZ1NsYXNoID0gc3Vic3RyKHBhdGgsIC0xKSA9PT0gJy8nO1xuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxuICBwYXRoID0gbm9ybWFsaXplQXJyYXkoZmlsdGVyKHBhdGguc3BsaXQoJy8nKSwgZnVuY3Rpb24ocCkge1xuICAgIHJldHVybiAhIXA7XG4gIH0pLCAhaXNBYnNvbHV0ZSkuam9pbignLycpO1xuXG4gIGlmICghcGF0aCAmJiAhaXNBYnNvbHV0ZSkge1xuICAgIHBhdGggPSAnLic7XG4gIH1cbiAgaWYgKHBhdGggJiYgdHJhaWxpbmdTbGFzaCkge1xuICAgIHBhdGggKz0gJy8nO1xuICB9XG5cbiAgcmV0dXJuIChpc0Fic29sdXRlID8gJy8nIDogJycpICsgcGF0aDtcbn07XG5cbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMuaXNBYnNvbHV0ZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgcmV0dXJuIHBhdGguY2hhckF0KDApID09PSAnLyc7XG59O1xuXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLmpvaW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhdGhzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAwKTtcbiAgcmV0dXJuIGV4cG9ydHMubm9ybWFsaXplKGZpbHRlcihwYXRocywgZnVuY3Rpb24ocCwgaW5kZXgpIHtcbiAgICBpZiAodHlwZW9mIHAgIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgdG8gcGF0aC5qb2luIG11c3QgYmUgc3RyaW5ncycpO1xuICAgIH1cbiAgICByZXR1cm4gcDtcbiAgfSkuam9pbignLycpKTtcbn07XG5cblxuLy8gcGF0aC5yZWxhdGl2ZShmcm9tLCB0bylcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMucmVsYXRpdmUgPSBmdW5jdGlvbihmcm9tLCB0bykge1xuICBmcm9tID0gZXhwb3J0cy5yZXNvbHZlKGZyb20pLnN1YnN0cigxKTtcbiAgdG8gPSBleHBvcnRzLnJlc29sdmUodG8pLnN1YnN0cigxKTtcblxuICBmdW5jdGlvbiB0cmltKGFycikge1xuICAgIHZhciBzdGFydCA9IDA7XG4gICAgZm9yICg7IHN0YXJ0IDwgYXJyLmxlbmd0aDsgc3RhcnQrKykge1xuICAgICAgaWYgKGFycltzdGFydF0gIT09ICcnKSBicmVhaztcbiAgICB9XG5cbiAgICB2YXIgZW5kID0gYXJyLmxlbmd0aCAtIDE7XG4gICAgZm9yICg7IGVuZCA+PSAwOyBlbmQtLSkge1xuICAgICAgaWYgKGFycltlbmRdICE9PSAnJykgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYgKHN0YXJ0ID4gZW5kKSByZXR1cm4gW107XG4gICAgcmV0dXJuIGFyci5zbGljZShzdGFydCwgZW5kIC0gc3RhcnQgKyAxKTtcbiAgfVxuXG4gIHZhciBmcm9tUGFydHMgPSB0cmltKGZyb20uc3BsaXQoJy8nKSk7XG4gIHZhciB0b1BhcnRzID0gdHJpbSh0by5zcGxpdCgnLycpKTtcblxuICB2YXIgbGVuZ3RoID0gTWF0aC5taW4oZnJvbVBhcnRzLmxlbmd0aCwgdG9QYXJ0cy5sZW5ndGgpO1xuICB2YXIgc2FtZVBhcnRzTGVuZ3RoID0gbGVuZ3RoO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGZyb21QYXJ0c1tpXSAhPT0gdG9QYXJ0c1tpXSkge1xuICAgICAgc2FtZVBhcnRzTGVuZ3RoID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHZhciBvdXRwdXRQYXJ0cyA9IFtdO1xuICBmb3IgKHZhciBpID0gc2FtZVBhcnRzTGVuZ3RoOyBpIDwgZnJvbVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0cHV0UGFydHMucHVzaCgnLi4nKTtcbiAgfVxuXG4gIG91dHB1dFBhcnRzID0gb3V0cHV0UGFydHMuY29uY2F0KHRvUGFydHMuc2xpY2Uoc2FtZVBhcnRzTGVuZ3RoKSk7XG5cbiAgcmV0dXJuIG91dHB1dFBhcnRzLmpvaW4oJy8nKTtcbn07XG5cbmV4cG9ydHMuc2VwID0gJy8nO1xuZXhwb3J0cy5kZWxpbWl0ZXIgPSAnOic7XG5cbmV4cG9ydHMuZGlybmFtZSA9IGZ1bmN0aW9uIChwYXRoKSB7XG4gIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHBhdGggPSBwYXRoICsgJyc7XG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcuJztcbiAgdmFyIGNvZGUgPSBwYXRoLmNoYXJDb2RlQXQoMCk7XG4gIHZhciBoYXNSb290ID0gY29kZSA9PT0gNDcgLyovKi87XG4gIHZhciBlbmQgPSAtMTtcbiAgdmFyIG1hdGNoZWRTbGFzaCA9IHRydWU7XG4gIGZvciAodmFyIGkgPSBwYXRoLmxlbmd0aCAtIDE7IGkgPj0gMTsgLS1pKSB7XG4gICAgY29kZSA9IHBhdGguY2hhckNvZGVBdChpKTtcbiAgICBpZiAoY29kZSA9PT0gNDcgLyovKi8pIHtcbiAgICAgICAgaWYgKCFtYXRjaGVkU2xhc2gpIHtcbiAgICAgICAgICBlbmQgPSBpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgLy8gV2Ugc2F3IHRoZSBmaXJzdCBub24tcGF0aCBzZXBhcmF0b3JcbiAgICAgIG1hdGNoZWRTbGFzaCA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChlbmQgPT09IC0xKSByZXR1cm4gaGFzUm9vdCA/ICcvJyA6ICcuJztcbiAgaWYgKGhhc1Jvb3QgJiYgZW5kID09PSAxKSB7XG4gICAgLy8gcmV0dXJuICcvLyc7XG4gICAgLy8gQmFja3dhcmRzLWNvbXBhdCBmaXg6XG4gICAgcmV0dXJuICcvJztcbiAgfVxuICByZXR1cm4gcGF0aC5zbGljZSgwLCBlbmQpO1xufTtcblxuZnVuY3Rpb24gYmFzZW5hbWUocGF0aCkge1xuICBpZiAodHlwZW9mIHBhdGggIT09ICdzdHJpbmcnKSBwYXRoID0gcGF0aCArICcnO1xuXG4gIHZhciBzdGFydCA9IDA7XG4gIHZhciBlbmQgPSAtMTtcbiAgdmFyIG1hdGNoZWRTbGFzaCA9IHRydWU7XG4gIHZhciBpO1xuXG4gIGZvciAoaSA9IHBhdGgubGVuZ3RoIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICBpZiAocGF0aC5jaGFyQ29kZUF0KGkpID09PSA0NyAvKi8qLykge1xuICAgICAgICAvLyBJZiB3ZSByZWFjaGVkIGEgcGF0aCBzZXBhcmF0b3IgdGhhdCB3YXMgbm90IHBhcnQgb2YgYSBzZXQgb2YgcGF0aFxuICAgICAgICAvLyBzZXBhcmF0b3JzIGF0IHRoZSBlbmQgb2YgdGhlIHN0cmluZywgc3RvcCBub3dcbiAgICAgICAgaWYgKCFtYXRjaGVkU2xhc2gpIHtcbiAgICAgICAgICBzdGFydCA9IGkgKyAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGVuZCA9PT0gLTEpIHtcbiAgICAgIC8vIFdlIHNhdyB0aGUgZmlyc3Qgbm9uLXBhdGggc2VwYXJhdG9yLCBtYXJrIHRoaXMgYXMgdGhlIGVuZCBvZiBvdXJcbiAgICAgIC8vIHBhdGggY29tcG9uZW50XG4gICAgICBtYXRjaGVkU2xhc2ggPSBmYWxzZTtcbiAgICAgIGVuZCA9IGkgKyAxO1xuICAgIH1cbiAgfVxuXG4gIGlmIChlbmQgPT09IC0xKSByZXR1cm4gJyc7XG4gIHJldHVybiBwYXRoLnNsaWNlKHN0YXJ0LCBlbmQpO1xufVxuXG4vLyBVc2VzIGEgbWl4ZWQgYXBwcm9hY2ggZm9yIGJhY2t3YXJkcy1jb21wYXRpYmlsaXR5LCBhcyBleHQgYmVoYXZpb3IgY2hhbmdlZFxuLy8gaW4gbmV3IE5vZGUuanMgdmVyc2lvbnMsIHNvIG9ubHkgYmFzZW5hbWUoKSBhYm92ZSBpcyBiYWNrcG9ydGVkIGhlcmVcbmV4cG9ydHMuYmFzZW5hbWUgPSBmdW5jdGlvbiAocGF0aCwgZXh0KSB7XG4gIHZhciBmID0gYmFzZW5hbWUocGF0aCk7XG4gIGlmIChleHQgJiYgZi5zdWJzdHIoLTEgKiBleHQubGVuZ3RoKSA9PT0gZXh0KSB7XG4gICAgZiA9IGYuc3Vic3RyKDAsIGYubGVuZ3RoIC0gZXh0Lmxlbmd0aCk7XG4gIH1cbiAgcmV0dXJuIGY7XG59O1xuXG5leHBvcnRzLmV4dG5hbWUgPSBmdW5jdGlvbiAocGF0aCkge1xuICBpZiAodHlwZW9mIHBhdGggIT09ICdzdHJpbmcnKSBwYXRoID0gcGF0aCArICcnO1xuICB2YXIgc3RhcnREb3QgPSAtMTtcbiAgdmFyIHN0YXJ0UGFydCA9IDA7XG4gIHZhciBlbmQgPSAtMTtcbiAgdmFyIG1hdGNoZWRTbGFzaCA9IHRydWU7XG4gIC8vIFRyYWNrIHRoZSBzdGF0ZSBvZiBjaGFyYWN0ZXJzIChpZiBhbnkpIHdlIHNlZSBiZWZvcmUgb3VyIGZpcnN0IGRvdCBhbmRcbiAgLy8gYWZ0ZXIgYW55IHBhdGggc2VwYXJhdG9yIHdlIGZpbmRcbiAgdmFyIHByZURvdFN0YXRlID0gMDtcbiAgZm9yICh2YXIgaSA9IHBhdGgubGVuZ3RoIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICB2YXIgY29kZSA9IHBhdGguY2hhckNvZGVBdChpKTtcbiAgICBpZiAoY29kZSA9PT0gNDcgLyovKi8pIHtcbiAgICAgICAgLy8gSWYgd2UgcmVhY2hlZCBhIHBhdGggc2VwYXJhdG9yIHRoYXQgd2FzIG5vdCBwYXJ0IG9mIGEgc2V0IG9mIHBhdGhcbiAgICAgICAgLy8gc2VwYXJhdG9ycyBhdCB0aGUgZW5kIG9mIHRoZSBzdHJpbmcsIHN0b3Agbm93XG4gICAgICAgIGlmICghbWF0Y2hlZFNsYXNoKSB7XG4gICAgICAgICAgc3RhcnRQYXJ0ID0gaSArIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgaWYgKGVuZCA9PT0gLTEpIHtcbiAgICAgIC8vIFdlIHNhdyB0aGUgZmlyc3Qgbm9uLXBhdGggc2VwYXJhdG9yLCBtYXJrIHRoaXMgYXMgdGhlIGVuZCBvZiBvdXJcbiAgICAgIC8vIGV4dGVuc2lvblxuICAgICAgbWF0Y2hlZFNsYXNoID0gZmFsc2U7XG4gICAgICBlbmQgPSBpICsgMTtcbiAgICB9XG4gICAgaWYgKGNvZGUgPT09IDQ2IC8qLiovKSB7XG4gICAgICAgIC8vIElmIHRoaXMgaXMgb3VyIGZpcnN0IGRvdCwgbWFyayBpdCBhcyB0aGUgc3RhcnQgb2Ygb3VyIGV4dGVuc2lvblxuICAgICAgICBpZiAoc3RhcnREb3QgPT09IC0xKVxuICAgICAgICAgIHN0YXJ0RG90ID0gaTtcbiAgICAgICAgZWxzZSBpZiAocHJlRG90U3RhdGUgIT09IDEpXG4gICAgICAgICAgcHJlRG90U3RhdGUgPSAxO1xuICAgIH0gZWxzZSBpZiAoc3RhcnREb3QgIT09IC0xKSB7XG4gICAgICAvLyBXZSBzYXcgYSBub24tZG90IGFuZCBub24tcGF0aCBzZXBhcmF0b3IgYmVmb3JlIG91ciBkb3QsIHNvIHdlIHNob3VsZFxuICAgICAgLy8gaGF2ZSBhIGdvb2QgY2hhbmNlIGF0IGhhdmluZyBhIG5vbi1lbXB0eSBleHRlbnNpb25cbiAgICAgIHByZURvdFN0YXRlID0gLTE7XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0RG90ID09PSAtMSB8fCBlbmQgPT09IC0xIHx8XG4gICAgICAvLyBXZSBzYXcgYSBub24tZG90IGNoYXJhY3RlciBpbW1lZGlhdGVseSBiZWZvcmUgdGhlIGRvdFxuICAgICAgcHJlRG90U3RhdGUgPT09IDAgfHxcbiAgICAgIC8vIFRoZSAocmlnaHQtbW9zdCkgdHJpbW1lZCBwYXRoIGNvbXBvbmVudCBpcyBleGFjdGx5ICcuLidcbiAgICAgIHByZURvdFN0YXRlID09PSAxICYmIHN0YXJ0RG90ID09PSBlbmQgLSAxICYmIHN0YXJ0RG90ID09PSBzdGFydFBhcnQgKyAxKSB7XG4gICAgcmV0dXJuICcnO1xuICB9XG4gIHJldHVybiBwYXRoLnNsaWNlKHN0YXJ0RG90LCBlbmQpO1xufTtcblxuZnVuY3Rpb24gZmlsdGVyICh4cywgZikge1xuICAgIGlmICh4cy5maWx0ZXIpIHJldHVybiB4cy5maWx0ZXIoZik7XG4gICAgdmFyIHJlcyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgeHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGYoeHNbaV0sIGksIHhzKSkgcmVzLnB1c2goeHNbaV0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xufVxuXG4vLyBTdHJpbmcucHJvdG90eXBlLnN1YnN0ciAtIG5lZ2F0aXZlIGluZGV4IGRvbid0IHdvcmsgaW4gSUU4XG52YXIgc3Vic3RyID0gJ2FiJy5zdWJzdHIoLTEpID09PSAnYidcbiAgICA/IGZ1bmN0aW9uIChzdHIsIHN0YXJ0LCBsZW4pIHsgcmV0dXJuIHN0ci5zdWJzdHIoc3RhcnQsIGxlbikgfVxuICAgIDogZnVuY3Rpb24gKHN0ciwgc3RhcnQsIGxlbikge1xuICAgICAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IHN0ci5sZW5ndGggKyBzdGFydDtcbiAgICAgICAgcmV0dXJuIHN0ci5zdWJzdHIoc3RhcnQsIGxlbik7XG4gICAgfVxuO1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbi8vIGNhY2hlZCBmcm9tIHdoYXRldmVyIGdsb2JhbCBpcyBwcmVzZW50IHNvIHRoYXQgdGVzdCBydW5uZXJzIHRoYXQgc3R1YiBpdFxuLy8gZG9uJ3QgYnJlYWsgdGhpbmdzLiAgQnV0IHdlIG5lZWQgdG8gd3JhcCBpdCBpbiBhIHRyeSBjYXRjaCBpbiBjYXNlIGl0IGlzXG4vLyB3cmFwcGVkIGluIHN0cmljdCBtb2RlIGNvZGUgd2hpY2ggZG9lc24ndCBkZWZpbmUgYW55IGdsb2JhbHMuICBJdCdzIGluc2lkZSBhXG4vLyBmdW5jdGlvbiBiZWNhdXNlIHRyeS9jYXRjaGVzIGRlb3B0aW1pemUgaW4gY2VydGFpbiBlbmdpbmVzLlxuXG52YXIgY2FjaGVkU2V0VGltZW91dDtcbnZhciBjYWNoZWRDbGVhclRpbWVvdXQ7XG5cbmZ1bmN0aW9uIGRlZmF1bHRTZXRUaW1vdXQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzZXRUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG5mdW5jdGlvbiBkZWZhdWx0Q2xlYXJUaW1lb3V0ICgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyVGltZW91dCBoYXMgbm90IGJlZW4gZGVmaW5lZCcpO1xufVxuKGZ1bmN0aW9uICgpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAodHlwZW9mIHNldFRpbWVvdXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBzZXRUaW1lb3V0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBkZWZhdWx0U2V0VGltb3V0O1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICBpZiAodHlwZW9mIGNsZWFyVGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gY2xlYXJUaW1lb3V0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gZGVmYXVsdENsZWFyVGltZW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gZGVmYXVsdENsZWFyVGltZW91dDtcbiAgICB9XG59ICgpKVxuZnVuY3Rpb24gcnVuVGltZW91dChmdW4pIHtcbiAgICBpZiAoY2FjaGVkU2V0VGltZW91dCA9PT0gc2V0VGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgLy8gaWYgc2V0VGltZW91dCB3YXNuJ3QgYXZhaWxhYmxlIGJ1dCB3YXMgbGF0dGVyIGRlZmluZWRcbiAgICBpZiAoKGNhY2hlZFNldFRpbWVvdXQgPT09IGRlZmF1bHRTZXRUaW1vdXQgfHwgIWNhY2hlZFNldFRpbWVvdXQpICYmIHNldFRpbWVvdXQpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIC8vIHdoZW4gd2hlbiBzb21lYm9keSBoYXMgc2NyZXdlZCB3aXRoIHNldFRpbWVvdXQgYnV0IG5vIEkuRS4gbWFkZG5lc3NcbiAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9IGNhdGNoKGUpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gV2hlbiB3ZSBhcmUgaW4gSS5FLiBidXQgdGhlIHNjcmlwdCBoYXMgYmVlbiBldmFsZWQgc28gSS5FLiBkb2Vzbid0IHRydXN0IHRoZSBnbG9iYWwgb2JqZWN0IHdoZW4gY2FsbGVkIG5vcm1hbGx5XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKG51bGwsIGZ1biwgMCk7XG4gICAgICAgIH0gY2F0Y2goZSl7XG4gICAgICAgICAgICAvLyBzYW1lIGFzIGFib3ZlIGJ1dCB3aGVuIGl0J3MgYSB2ZXJzaW9uIG9mIEkuRS4gdGhhdCBtdXN0IGhhdmUgdGhlIGdsb2JhbCBvYmplY3QgZm9yICd0aGlzJywgaG9wZnVsbHkgb3VyIGNvbnRleHQgY29ycmVjdCBvdGhlcndpc2UgaXQgd2lsbCB0aHJvdyBhIGdsb2JhbCBlcnJvclxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQuY2FsbCh0aGlzLCBmdW4sIDApO1xuICAgICAgICB9XG4gICAgfVxuXG5cbn1cbmZ1bmN0aW9uIHJ1bkNsZWFyVGltZW91dChtYXJrZXIpIHtcbiAgICBpZiAoY2FjaGVkQ2xlYXJUaW1lb3V0ID09PSBjbGVhclRpbWVvdXQpIHtcbiAgICAgICAgLy9ub3JtYWwgZW52aXJvbWVudHMgaW4gc2FuZSBzaXR1YXRpb25zXG4gICAgICAgIHJldHVybiBjbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9XG4gICAgLy8gaWYgY2xlYXJUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkQ2xlYXJUaW1lb3V0ID09PSBkZWZhdWx0Q2xlYXJUaW1lb3V0IHx8ICFjYWNoZWRDbGVhclRpbWVvdXQpICYmIGNsZWFyVGltZW91dCkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIHJldHVybiBjbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfSBjYXRjaCAoZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgIHRydXN0IHRoZSBnbG9iYWwgb2JqZWN0IHdoZW4gY2FsbGVkIG5vcm1hbGx5XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0LmNhbGwobnVsbCwgbWFya2VyKTtcbiAgICAgICAgfSBjYXRjaCAoZSl7XG4gICAgICAgICAgICAvLyBzYW1lIGFzIGFib3ZlIGJ1dCB3aGVuIGl0J3MgYSB2ZXJzaW9uIG9mIEkuRS4gdGhhdCBtdXN0IGhhdmUgdGhlIGdsb2JhbCBvYmplY3QgZm9yICd0aGlzJywgaG9wZnVsbHkgb3VyIGNvbnRleHQgY29ycmVjdCBvdGhlcndpc2UgaXQgd2lsbCB0aHJvdyBhIGdsb2JhbCBlcnJvci5cbiAgICAgICAgICAgIC8vIFNvbWUgdmVyc2lvbnMgb2YgSS5FLiBoYXZlIGRpZmZlcmVudCBydWxlcyBmb3IgY2xlYXJUaW1lb3V0IHZzIHNldFRpbWVvdXRcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbCh0aGlzLCBtYXJrZXIpO1xuICAgICAgICB9XG4gICAgfVxuXG5cblxufVxudmFyIHF1ZXVlID0gW107XG52YXIgZHJhaW5pbmcgPSBmYWxzZTtcbnZhciBjdXJyZW50UXVldWU7XG52YXIgcXVldWVJbmRleCA9IC0xO1xuXG5mdW5jdGlvbiBjbGVhblVwTmV4dFRpY2soKSB7XG4gICAgaWYgKCFkcmFpbmluZyB8fCAhY3VycmVudFF1ZXVlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBpZiAoY3VycmVudFF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBxdWV1ZSA9IGN1cnJlbnRRdWV1ZS5jb25jYXQocXVldWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICB9XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBkcmFpblF1ZXVlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkcmFpblF1ZXVlKCkge1xuICAgIGlmIChkcmFpbmluZykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciB0aW1lb3V0ID0gcnVuVGltZW91dChjbGVhblVwTmV4dFRpY2spO1xuICAgIGRyYWluaW5nID0gdHJ1ZTtcblxuICAgIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUobGVuKSB7XG4gICAgICAgIGN1cnJlbnRRdWV1ZSA9IHF1ZXVlO1xuICAgICAgICBxdWV1ZSA9IFtdO1xuICAgICAgICB3aGlsZSAoKytxdWV1ZUluZGV4IDwgbGVuKSB7XG4gICAgICAgICAgICBpZiAoY3VycmVudFF1ZXVlKSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgcnVuQ2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgcnVuVGltZW91dChkcmFpblF1ZXVlKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xucHJvY2Vzcy5wcmVwZW5kTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5wcmVwZW5kT25jZUxpc3RlbmVyID0gbm9vcDtcblxucHJvY2Vzcy5saXN0ZW5lcnMgPSBmdW5jdGlvbiAobmFtZSkgeyByZXR1cm4gW10gfVxuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xucHJvY2Vzcy51bWFzayA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gMDsgfTtcbiIsIihmdW5jdGlvbihzZWxmKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICBpZiAoc2VsZi5mZXRjaCkge1xuICAgIHJldHVyblxuICB9XG5cbiAgdmFyIHN1cHBvcnQgPSB7XG4gICAgc2VhcmNoUGFyYW1zOiAnVVJMU2VhcmNoUGFyYW1zJyBpbiBzZWxmLFxuICAgIGl0ZXJhYmxlOiAnU3ltYm9sJyBpbiBzZWxmICYmICdpdGVyYXRvcicgaW4gU3ltYm9sLFxuICAgIGJsb2I6ICdGaWxlUmVhZGVyJyBpbiBzZWxmICYmICdCbG9iJyBpbiBzZWxmICYmIChmdW5jdGlvbigpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG5ldyBCbG9iKClcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0gY2F0Y2goZSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9KSgpLFxuICAgIGZvcm1EYXRhOiAnRm9ybURhdGEnIGluIHNlbGYsXG4gICAgYXJyYXlCdWZmZXI6ICdBcnJheUJ1ZmZlcicgaW4gc2VsZlxuICB9XG5cbiAgaWYgKHN1cHBvcnQuYXJyYXlCdWZmZXIpIHtcbiAgICB2YXIgdmlld0NsYXNzZXMgPSBbXG4gICAgICAnW29iamVjdCBJbnQ4QXJyYXldJyxcbiAgICAgICdbb2JqZWN0IFVpbnQ4QXJyYXldJyxcbiAgICAgICdbb2JqZWN0IFVpbnQ4Q2xhbXBlZEFycmF5XScsXG4gICAgICAnW29iamVjdCBJbnQxNkFycmF5XScsXG4gICAgICAnW29iamVjdCBVaW50MTZBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgSW50MzJBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgVWludDMyQXJyYXldJyxcbiAgICAgICdbb2JqZWN0IEZsb2F0MzJBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgRmxvYXQ2NEFycmF5XSdcbiAgICBdXG5cbiAgICB2YXIgaXNEYXRhVmlldyA9IGZ1bmN0aW9uKG9iaikge1xuICAgICAgcmV0dXJuIG9iaiAmJiBEYXRhVmlldy5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihvYmopXG4gICAgfVxuXG4gICAgdmFyIGlzQXJyYXlCdWZmZXJWaWV3ID0gQXJyYXlCdWZmZXIuaXNWaWV3IHx8IGZ1bmN0aW9uKG9iaikge1xuICAgICAgcmV0dXJuIG9iaiAmJiB2aWV3Q2xhc3Nlcy5pbmRleE9mKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopKSA+IC0xXG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gbm9ybWFsaXplTmFtZShuYW1lKSB7XG4gICAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJykge1xuICAgICAgbmFtZSA9IFN0cmluZyhuYW1lKVxuICAgIH1cbiAgICBpZiAoL1teYS16MC05XFwtIyQlJicqKy5cXF5fYHx+XS9pLnRlc3QobmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgY2hhcmFjdGVyIGluIGhlYWRlciBmaWVsZCBuYW1lJylcbiAgICB9XG4gICAgcmV0dXJuIG5hbWUudG9Mb3dlckNhc2UoKVxuICB9XG5cbiAgZnVuY3Rpb24gbm9ybWFsaXplVmFsdWUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykge1xuICAgICAgdmFsdWUgPSBTdHJpbmcodmFsdWUpXG4gICAgfVxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLy8gQnVpbGQgYSBkZXN0cnVjdGl2ZSBpdGVyYXRvciBmb3IgdGhlIHZhbHVlIGxpc3RcbiAgZnVuY3Rpb24gaXRlcmF0b3JGb3IoaXRlbXMpIHtcbiAgICB2YXIgaXRlcmF0b3IgPSB7XG4gICAgICBuZXh0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gaXRlbXMuc2hpZnQoKVxuICAgICAgICByZXR1cm4ge2RvbmU6IHZhbHVlID09PSB1bmRlZmluZWQsIHZhbHVlOiB2YWx1ZX1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3VwcG9ydC5pdGVyYWJsZSkge1xuICAgICAgaXRlcmF0b3JbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gaXRlcmF0b3JcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaXRlcmF0b3JcbiAgfVxuXG4gIGZ1bmN0aW9uIEhlYWRlcnMoaGVhZGVycykge1xuICAgIHRoaXMubWFwID0ge31cblxuICAgIGlmIChoZWFkZXJzIGluc3RhbmNlb2YgSGVhZGVycykge1xuICAgICAgaGVhZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgIHRoaXMuYXBwZW5kKG5hbWUsIHZhbHVlKVxuICAgICAgfSwgdGhpcylcbiAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoaGVhZGVycykpIHtcbiAgICAgIGhlYWRlcnMuZm9yRWFjaChmdW5jdGlvbihoZWFkZXIpIHtcbiAgICAgICAgdGhpcy5hcHBlbmQoaGVhZGVyWzBdLCBoZWFkZXJbMV0pXG4gICAgICB9LCB0aGlzKVxuICAgIH0gZWxzZSBpZiAoaGVhZGVycykge1xuICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoaGVhZGVycykuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICAgIHRoaXMuYXBwZW5kKG5hbWUsIGhlYWRlcnNbbmFtZV0pXG4gICAgICB9LCB0aGlzKVxuICAgIH1cbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gICAgbmFtZSA9IG5vcm1hbGl6ZU5hbWUobmFtZSlcbiAgICB2YWx1ZSA9IG5vcm1hbGl6ZVZhbHVlKHZhbHVlKVxuICAgIHZhciBvbGRWYWx1ZSA9IHRoaXMubWFwW25hbWVdXG4gICAgdGhpcy5tYXBbbmFtZV0gPSBvbGRWYWx1ZSA/IG9sZFZhbHVlKycsJyt2YWx1ZSA6IHZhbHVlXG4gIH1cblxuICBIZWFkZXJzLnByb3RvdHlwZVsnZGVsZXRlJ10gPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgZGVsZXRlIHRoaXMubWFwW25vcm1hbGl6ZU5hbWUobmFtZSldXG4gIH1cblxuICBIZWFkZXJzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgbmFtZSA9IG5vcm1hbGl6ZU5hbWUobmFtZSlcbiAgICByZXR1cm4gdGhpcy5oYXMobmFtZSkgPyB0aGlzLm1hcFtuYW1lXSA6IG51bGxcbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmhhcyA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5tYXAuaGFzT3duUHJvcGVydHkobm9ybWFsaXplTmFtZShuYW1lKSlcbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gICAgdGhpcy5tYXBbbm9ybWFsaXplTmFtZShuYW1lKV0gPSBub3JtYWxpemVWYWx1ZSh2YWx1ZSlcbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmZvckVhY2ggPSBmdW5jdGlvbihjYWxsYmFjaywgdGhpc0FyZykge1xuICAgIGZvciAodmFyIG5hbWUgaW4gdGhpcy5tYXApIHtcbiAgICAgIGlmICh0aGlzLm1hcC5oYXNPd25Qcm9wZXJ0eShuYW1lKSkge1xuICAgICAgICBjYWxsYmFjay5jYWxsKHRoaXNBcmcsIHRoaXMubWFwW25hbWVdLCBuYW1lLCB0aGlzKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmtleXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgaXRlbXMgPSBbXVxuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSwgbmFtZSkgeyBpdGVtcy5wdXNoKG5hbWUpIH0pXG4gICAgcmV0dXJuIGl0ZXJhdG9yRm9yKGl0ZW1zKVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUudmFsdWVzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGl0ZW1zID0gW11cbiAgICB0aGlzLmZvckVhY2goZnVuY3Rpb24odmFsdWUpIHsgaXRlbXMucHVzaCh2YWx1ZSkgfSlcbiAgICByZXR1cm4gaXRlcmF0b3JGb3IoaXRlbXMpXG4gIH1cblxuICBIZWFkZXJzLnByb3RvdHlwZS5lbnRyaWVzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGl0ZW1zID0gW11cbiAgICB0aGlzLmZvckVhY2goZnVuY3Rpb24odmFsdWUsIG5hbWUpIHsgaXRlbXMucHVzaChbbmFtZSwgdmFsdWVdKSB9KVxuICAgIHJldHVybiBpdGVyYXRvckZvcihpdGVtcylcbiAgfVxuXG4gIGlmIChzdXBwb3J0Lml0ZXJhYmxlKSB7XG4gICAgSGVhZGVycy5wcm90b3R5cGVbU3ltYm9sLml0ZXJhdG9yXSA9IEhlYWRlcnMucHJvdG90eXBlLmVudHJpZXNcbiAgfVxuXG4gIGZ1bmN0aW9uIGNvbnN1bWVkKGJvZHkpIHtcbiAgICBpZiAoYm9keS5ib2R5VXNlZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoJ0FscmVhZHkgcmVhZCcpKVxuICAgIH1cbiAgICBib2R5LmJvZHlVc2VkID0gdHJ1ZVxuICB9XG5cbiAgZnVuY3Rpb24gZmlsZVJlYWRlclJlYWR5KHJlYWRlcikge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlYWRlci5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZShyZWFkZXIucmVzdWx0KVxuICAgICAgfVxuICAgICAgcmVhZGVyLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KHJlYWRlci5lcnJvcilcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgZnVuY3Rpb24gcmVhZEJsb2JBc0FycmF5QnVmZmVyKGJsb2IpIHtcbiAgICB2YXIgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKVxuICAgIHZhciBwcm9taXNlID0gZmlsZVJlYWRlclJlYWR5KHJlYWRlcilcbiAgICByZWFkZXIucmVhZEFzQXJyYXlCdWZmZXIoYmxvYilcbiAgICByZXR1cm4gcHJvbWlzZVxuICB9XG5cbiAgZnVuY3Rpb24gcmVhZEJsb2JBc1RleHQoYmxvYikge1xuICAgIHZhciByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpXG4gICAgdmFyIHByb21pc2UgPSBmaWxlUmVhZGVyUmVhZHkocmVhZGVyKVxuICAgIHJlYWRlci5yZWFkQXNUZXh0KGJsb2IpXG4gICAgcmV0dXJuIHByb21pc2VcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlYWRBcnJheUJ1ZmZlckFzVGV4dChidWYpIHtcbiAgICB2YXIgdmlldyA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICB2YXIgY2hhcnMgPSBuZXcgQXJyYXkodmlldy5sZW5ndGgpXG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXcubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNoYXJzW2ldID0gU3RyaW5nLmZyb21DaGFyQ29kZSh2aWV3W2ldKVxuICAgIH1cbiAgICByZXR1cm4gY2hhcnMuam9pbignJylcbiAgfVxuXG4gIGZ1bmN0aW9uIGJ1ZmZlckNsb25lKGJ1Zikge1xuICAgIGlmIChidWYuc2xpY2UpIHtcbiAgICAgIHJldHVybiBidWYuc2xpY2UoMClcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHZpZXcgPSBuZXcgVWludDhBcnJheShidWYuYnl0ZUxlbmd0aClcbiAgICAgIHZpZXcuc2V0KG5ldyBVaW50OEFycmF5KGJ1ZikpXG4gICAgICByZXR1cm4gdmlldy5idWZmZXJcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBCb2R5KCkge1xuICAgIHRoaXMuYm9keVVzZWQgPSBmYWxzZVxuXG4gICAgdGhpcy5faW5pdEJvZHkgPSBmdW5jdGlvbihib2R5KSB7XG4gICAgICB0aGlzLl9ib2R5SW5pdCA9IGJvZHlcbiAgICAgIGlmICghYm9keSkge1xuICAgICAgICB0aGlzLl9ib2R5VGV4dCA9ICcnXG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBib2R5ID09PSAnc3RyaW5nJykge1xuICAgICAgICB0aGlzLl9ib2R5VGV4dCA9IGJvZHlcbiAgICAgIH0gZWxzZSBpZiAoc3VwcG9ydC5ibG9iICYmIEJsb2IucHJvdG90eXBlLmlzUHJvdG90eXBlT2YoYm9keSkpIHtcbiAgICAgICAgdGhpcy5fYm9keUJsb2IgPSBib2R5XG4gICAgICB9IGVsc2UgaWYgKHN1cHBvcnQuZm9ybURhdGEgJiYgRm9ybURhdGEucHJvdG90eXBlLmlzUHJvdG90eXBlT2YoYm9keSkpIHtcbiAgICAgICAgdGhpcy5fYm9keUZvcm1EYXRhID0gYm9keVxuICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LnNlYXJjaFBhcmFtcyAmJiBVUkxTZWFyY2hQYXJhbXMucHJvdG90eXBlLmlzUHJvdG90eXBlT2YoYm9keSkpIHtcbiAgICAgICAgdGhpcy5fYm9keVRleHQgPSBib2R5LnRvU3RyaW5nKClcbiAgICAgIH0gZWxzZSBpZiAoc3VwcG9ydC5hcnJheUJ1ZmZlciAmJiBzdXBwb3J0LmJsb2IgJiYgaXNEYXRhVmlldyhib2R5KSkge1xuICAgICAgICB0aGlzLl9ib2R5QXJyYXlCdWZmZXIgPSBidWZmZXJDbG9uZShib2R5LmJ1ZmZlcilcbiAgICAgICAgLy8gSUUgMTAtMTEgY2FuJ3QgaGFuZGxlIGEgRGF0YVZpZXcgYm9keS5cbiAgICAgICAgdGhpcy5fYm9keUluaXQgPSBuZXcgQmxvYihbdGhpcy5fYm9keUFycmF5QnVmZmVyXSlcbiAgICAgIH0gZWxzZSBpZiAoc3VwcG9ydC5hcnJheUJ1ZmZlciAmJiAoQXJyYXlCdWZmZXIucHJvdG90eXBlLmlzUHJvdG90eXBlT2YoYm9keSkgfHwgaXNBcnJheUJ1ZmZlclZpZXcoYm9keSkpKSB7XG4gICAgICAgIHRoaXMuX2JvZHlBcnJheUJ1ZmZlciA9IGJ1ZmZlckNsb25lKGJvZHkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3Vuc3VwcG9ydGVkIEJvZHlJbml0IHR5cGUnKVxuICAgICAgfVxuXG4gICAgICBpZiAoIXRoaXMuaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpKSB7XG4gICAgICAgIGlmICh0eXBlb2YgYm9keSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICB0aGlzLmhlYWRlcnMuc2V0KCdjb250ZW50LXR5cGUnLCAndGV4dC9wbGFpbjtjaGFyc2V0PVVURi04JylcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9ib2R5QmxvYiAmJiB0aGlzLl9ib2R5QmxvYi50eXBlKSB7XG4gICAgICAgICAgdGhpcy5oZWFkZXJzLnNldCgnY29udGVudC10eXBlJywgdGhpcy5fYm9keUJsb2IudHlwZSlcbiAgICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LnNlYXJjaFBhcmFtcyAmJiBVUkxTZWFyY2hQYXJhbXMucHJvdG90eXBlLmlzUHJvdG90eXBlT2YoYm9keSkpIHtcbiAgICAgICAgICB0aGlzLmhlYWRlcnMuc2V0KCdjb250ZW50LXR5cGUnLCAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkO2NoYXJzZXQ9VVRGLTgnKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHN1cHBvcnQuYmxvYikge1xuICAgICAgdGhpcy5ibG9iID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciByZWplY3RlZCA9IGNvbnN1bWVkKHRoaXMpXG4gICAgICAgIGlmIChyZWplY3RlZCkge1xuICAgICAgICAgIHJldHVybiByZWplY3RlZFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuX2JvZHlCbG9iKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLl9ib2R5QmxvYilcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9ib2R5QXJyYXlCdWZmZXIpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBCbG9iKFt0aGlzLl9ib2R5QXJyYXlCdWZmZXJdKSlcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9ib2R5Rm9ybURhdGEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvdWxkIG5vdCByZWFkIEZvcm1EYXRhIGJvZHkgYXMgYmxvYicpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgQmxvYihbdGhpcy5fYm9keVRleHRdKSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aGlzLmFycmF5QnVmZmVyID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICh0aGlzLl9ib2R5QXJyYXlCdWZmZXIpIHtcbiAgICAgICAgICByZXR1cm4gY29uc3VtZWQodGhpcykgfHwgUHJvbWlzZS5yZXNvbHZlKHRoaXMuX2JvZHlBcnJheUJ1ZmZlcilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5ibG9iKCkudGhlbihyZWFkQmxvYkFzQXJyYXlCdWZmZXIpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnRleHQgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciByZWplY3RlZCA9IGNvbnN1bWVkKHRoaXMpXG4gICAgICBpZiAocmVqZWN0ZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlamVjdGVkXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9ib2R5QmxvYikge1xuICAgICAgICByZXR1cm4gcmVhZEJsb2JBc1RleHQodGhpcy5fYm9keUJsb2IpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlBcnJheUJ1ZmZlcikge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlYWRBcnJheUJ1ZmZlckFzVGV4dCh0aGlzLl9ib2R5QXJyYXlCdWZmZXIpKVxuICAgICAgfSBlbHNlIGlmICh0aGlzLl9ib2R5Rm9ybURhdGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdjb3VsZCBub3QgcmVhZCBGb3JtRGF0YSBib2R5IGFzIHRleHQnKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLl9ib2R5VGV4dClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3VwcG9ydC5mb3JtRGF0YSkge1xuICAgICAgdGhpcy5mb3JtRGF0YSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy50ZXh0KCkudGhlbihkZWNvZGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5qc29uID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpcy50ZXh0KCkudGhlbihKU09OLnBhcnNlKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvLyBIVFRQIG1ldGhvZHMgd2hvc2UgY2FwaXRhbGl6YXRpb24gc2hvdWxkIGJlIG5vcm1hbGl6ZWRcbiAgdmFyIG1ldGhvZHMgPSBbJ0RFTEVURScsICdHRVQnLCAnSEVBRCcsICdPUFRJT05TJywgJ1BPU1QnLCAnUFVUJ11cblxuICBmdW5jdGlvbiBub3JtYWxpemVNZXRob2QobWV0aG9kKSB7XG4gICAgdmFyIHVwY2FzZWQgPSBtZXRob2QudG9VcHBlckNhc2UoKVxuICAgIHJldHVybiAobWV0aG9kcy5pbmRleE9mKHVwY2FzZWQpID4gLTEpID8gdXBjYXNlZCA6IG1ldGhvZFxuICB9XG5cbiAgZnVuY3Rpb24gUmVxdWVzdChpbnB1dCwgb3B0aW9ucykge1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9XG4gICAgdmFyIGJvZHkgPSBvcHRpb25zLmJvZHlcblxuICAgIGlmIChpbnB1dCBpbnN0YW5jZW9mIFJlcXVlc3QpIHtcbiAgICAgIGlmIChpbnB1dC5ib2R5VXNlZCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBbHJlYWR5IHJlYWQnKVxuICAgICAgfVxuICAgICAgdGhpcy51cmwgPSBpbnB1dC51cmxcbiAgICAgIHRoaXMuY3JlZGVudGlhbHMgPSBpbnB1dC5jcmVkZW50aWFsc1xuICAgICAgaWYgKCFvcHRpb25zLmhlYWRlcnMpIHtcbiAgICAgICAgdGhpcy5oZWFkZXJzID0gbmV3IEhlYWRlcnMoaW5wdXQuaGVhZGVycylcbiAgICAgIH1cbiAgICAgIHRoaXMubWV0aG9kID0gaW5wdXQubWV0aG9kXG4gICAgICB0aGlzLm1vZGUgPSBpbnB1dC5tb2RlXG4gICAgICBpZiAoIWJvZHkgJiYgaW5wdXQuX2JvZHlJbml0ICE9IG51bGwpIHtcbiAgICAgICAgYm9keSA9IGlucHV0Ll9ib2R5SW5pdFxuICAgICAgICBpbnB1dC5ib2R5VXNlZCA9IHRydWVcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy51cmwgPSBTdHJpbmcoaW5wdXQpXG4gICAgfVxuXG4gICAgdGhpcy5jcmVkZW50aWFscyA9IG9wdGlvbnMuY3JlZGVudGlhbHMgfHwgdGhpcy5jcmVkZW50aWFscyB8fCAnb21pdCdcbiAgICBpZiAob3B0aW9ucy5oZWFkZXJzIHx8ICF0aGlzLmhlYWRlcnMpIHtcbiAgICAgIHRoaXMuaGVhZGVycyA9IG5ldyBIZWFkZXJzKG9wdGlvbnMuaGVhZGVycylcbiAgICB9XG4gICAgdGhpcy5tZXRob2QgPSBub3JtYWxpemVNZXRob2Qob3B0aW9ucy5tZXRob2QgfHwgdGhpcy5tZXRob2QgfHwgJ0dFVCcpXG4gICAgdGhpcy5tb2RlID0gb3B0aW9ucy5tb2RlIHx8IHRoaXMubW9kZSB8fCBudWxsXG4gICAgdGhpcy5yZWZlcnJlciA9IG51bGxcblxuICAgIGlmICgodGhpcy5tZXRob2QgPT09ICdHRVQnIHx8IHRoaXMubWV0aG9kID09PSAnSEVBRCcpICYmIGJvZHkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0JvZHkgbm90IGFsbG93ZWQgZm9yIEdFVCBvciBIRUFEIHJlcXVlc3RzJylcbiAgICB9XG4gICAgdGhpcy5faW5pdEJvZHkoYm9keSlcbiAgfVxuXG4gIFJlcXVlc3QucHJvdG90eXBlLmNsb25lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBSZXF1ZXN0KHRoaXMsIHsgYm9keTogdGhpcy5fYm9keUluaXQgfSlcbiAgfVxuXG4gIGZ1bmN0aW9uIGRlY29kZShib2R5KSB7XG4gICAgdmFyIGZvcm0gPSBuZXcgRm9ybURhdGEoKVxuICAgIGJvZHkudHJpbSgpLnNwbGl0KCcmJykuZm9yRWFjaChmdW5jdGlvbihieXRlcykge1xuICAgICAgaWYgKGJ5dGVzKSB7XG4gICAgICAgIHZhciBzcGxpdCA9IGJ5dGVzLnNwbGl0KCc9JylcbiAgICAgICAgdmFyIG5hbWUgPSBzcGxpdC5zaGlmdCgpLnJlcGxhY2UoL1xcKy9nLCAnICcpXG4gICAgICAgIHZhciB2YWx1ZSA9IHNwbGl0LmpvaW4oJz0nKS5yZXBsYWNlKC9cXCsvZywgJyAnKVxuICAgICAgICBmb3JtLmFwcGVuZChkZWNvZGVVUklDb21wb25lbnQobmFtZSksIGRlY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkpXG4gICAgICB9XG4gICAgfSlcbiAgICByZXR1cm4gZm9ybVxuICB9XG5cbiAgZnVuY3Rpb24gcGFyc2VIZWFkZXJzKHJhd0hlYWRlcnMpIHtcbiAgICB2YXIgaGVhZGVycyA9IG5ldyBIZWFkZXJzKClcbiAgICAvLyBSZXBsYWNlIGluc3RhbmNlcyBvZiBcXHJcXG4gYW5kIFxcbiBmb2xsb3dlZCBieSBhdCBsZWFzdCBvbmUgc3BhY2Ugb3IgaG9yaXpvbnRhbCB0YWIgd2l0aCBhIHNwYWNlXG4gICAgLy8gaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzcyMzAjc2VjdGlvbi0zLjJcbiAgICB2YXIgcHJlUHJvY2Vzc2VkSGVhZGVycyA9IHJhd0hlYWRlcnMucmVwbGFjZSgvXFxyP1xcbltcXHQgXSsvZywgJyAnKVxuICAgIHByZVByb2Nlc3NlZEhlYWRlcnMuc3BsaXQoL1xccj9cXG4vKS5mb3JFYWNoKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIHZhciBwYXJ0cyA9IGxpbmUuc3BsaXQoJzonKVxuICAgICAgdmFyIGtleSA9IHBhcnRzLnNoaWZ0KCkudHJpbSgpXG4gICAgICBpZiAoa2V5KSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IHBhcnRzLmpvaW4oJzonKS50cmltKClcbiAgICAgICAgaGVhZGVycy5hcHBlbmQoa2V5LCB2YWx1ZSlcbiAgICAgIH1cbiAgICB9KVxuICAgIHJldHVybiBoZWFkZXJzXG4gIH1cblxuICBCb2R5LmNhbGwoUmVxdWVzdC5wcm90b3R5cGUpXG5cbiAgZnVuY3Rpb24gUmVzcG9uc2UoYm9keUluaXQsIG9wdGlvbnMpIHtcbiAgICBpZiAoIW9wdGlvbnMpIHtcbiAgICAgIG9wdGlvbnMgPSB7fVxuICAgIH1cblxuICAgIHRoaXMudHlwZSA9ICdkZWZhdWx0J1xuICAgIHRoaXMuc3RhdHVzID0gb3B0aW9ucy5zdGF0dXMgPT09IHVuZGVmaW5lZCA/IDIwMCA6IG9wdGlvbnMuc3RhdHVzXG4gICAgdGhpcy5vayA9IHRoaXMuc3RhdHVzID49IDIwMCAmJiB0aGlzLnN0YXR1cyA8IDMwMFxuICAgIHRoaXMuc3RhdHVzVGV4dCA9ICdzdGF0dXNUZXh0JyBpbiBvcHRpb25zID8gb3B0aW9ucy5zdGF0dXNUZXh0IDogJ09LJ1xuICAgIHRoaXMuaGVhZGVycyA9IG5ldyBIZWFkZXJzKG9wdGlvbnMuaGVhZGVycylcbiAgICB0aGlzLnVybCA9IG9wdGlvbnMudXJsIHx8ICcnXG4gICAgdGhpcy5faW5pdEJvZHkoYm9keUluaXQpXG4gIH1cblxuICBCb2R5LmNhbGwoUmVzcG9uc2UucHJvdG90eXBlKVxuXG4gIFJlc3BvbnNlLnByb3RvdHlwZS5jbG9uZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UodGhpcy5fYm9keUluaXQsIHtcbiAgICAgIHN0YXR1czogdGhpcy5zdGF0dXMsXG4gICAgICBzdGF0dXNUZXh0OiB0aGlzLnN0YXR1c1RleHQsXG4gICAgICBoZWFkZXJzOiBuZXcgSGVhZGVycyh0aGlzLmhlYWRlcnMpLFxuICAgICAgdXJsOiB0aGlzLnVybFxuICAgIH0pXG4gIH1cblxuICBSZXNwb25zZS5lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXNwb25zZSA9IG5ldyBSZXNwb25zZShudWxsLCB7c3RhdHVzOiAwLCBzdGF0dXNUZXh0OiAnJ30pXG4gICAgcmVzcG9uc2UudHlwZSA9ICdlcnJvcidcbiAgICByZXR1cm4gcmVzcG9uc2VcbiAgfVxuXG4gIHZhciByZWRpcmVjdFN0YXR1c2VzID0gWzMwMSwgMzAyLCAzMDMsIDMwNywgMzA4XVxuXG4gIFJlc3BvbnNlLnJlZGlyZWN0ID0gZnVuY3Rpb24odXJsLCBzdGF0dXMpIHtcbiAgICBpZiAocmVkaXJlY3RTdGF0dXNlcy5pbmRleE9mKHN0YXR1cykgPT09IC0xKSB7XG4gICAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignSW52YWxpZCBzdGF0dXMgY29kZScpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7c3RhdHVzOiBzdGF0dXMsIGhlYWRlcnM6IHtsb2NhdGlvbjogdXJsfX0pXG4gIH1cblxuICBzZWxmLkhlYWRlcnMgPSBIZWFkZXJzXG4gIHNlbGYuUmVxdWVzdCA9IFJlcXVlc3RcbiAgc2VsZi5SZXNwb25zZSA9IFJlc3BvbnNlXG5cbiAgc2VsZi5mZXRjaCA9IGZ1bmN0aW9uKGlucHV0LCBpbml0KSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgdmFyIHJlcXVlc3QgPSBuZXcgUmVxdWVzdChpbnB1dCwgaW5pdClcbiAgICAgIHZhciB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKVxuXG4gICAgICB4aHIub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBvcHRpb25zID0ge1xuICAgICAgICAgIHN0YXR1czogeGhyLnN0YXR1cyxcbiAgICAgICAgICBzdGF0dXNUZXh0OiB4aHIuc3RhdHVzVGV4dCxcbiAgICAgICAgICBoZWFkZXJzOiBwYXJzZUhlYWRlcnMoeGhyLmdldEFsbFJlc3BvbnNlSGVhZGVycygpIHx8ICcnKVxuICAgICAgICB9XG4gICAgICAgIG9wdGlvbnMudXJsID0gJ3Jlc3BvbnNlVVJMJyBpbiB4aHIgPyB4aHIucmVzcG9uc2VVUkwgOiBvcHRpb25zLmhlYWRlcnMuZ2V0KCdYLVJlcXVlc3QtVVJMJylcbiAgICAgICAgdmFyIGJvZHkgPSAncmVzcG9uc2UnIGluIHhociA/IHhoci5yZXNwb25zZSA6IHhoci5yZXNwb25zZVRleHRcbiAgICAgICAgcmVzb2x2ZShuZXcgUmVzcG9uc2UoYm9keSwgb3B0aW9ucykpXG4gICAgICB9XG5cbiAgICAgIHhoci5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChuZXcgVHlwZUVycm9yKCdOZXR3b3JrIHJlcXVlc3QgZmFpbGVkJykpXG4gICAgICB9XG5cbiAgICAgIHhoci5vbnRpbWVvdXQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KG5ldyBUeXBlRXJyb3IoJ05ldHdvcmsgcmVxdWVzdCBmYWlsZWQnKSlcbiAgICAgIH1cblxuICAgICAgeGhyLm9wZW4ocmVxdWVzdC5tZXRob2QsIHJlcXVlc3QudXJsLCB0cnVlKVxuXG4gICAgICBpZiAocmVxdWVzdC5jcmVkZW50aWFscyA9PT0gJ2luY2x1ZGUnKSB7XG4gICAgICAgIHhoci53aXRoQ3JlZGVudGlhbHMgPSB0cnVlXG4gICAgICB9IGVsc2UgaWYgKHJlcXVlc3QuY3JlZGVudGlhbHMgPT09ICdvbWl0Jykge1xuICAgICAgICB4aHIud2l0aENyZWRlbnRpYWxzID0gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaWYgKCdyZXNwb25zZVR5cGUnIGluIHhociAmJiBzdXBwb3J0LmJsb2IpIHtcbiAgICAgICAgeGhyLnJlc3BvbnNlVHlwZSA9ICdibG9iJ1xuICAgICAgfVxuXG4gICAgICByZXF1ZXN0LmhlYWRlcnMuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSwgbmFtZSkge1xuICAgICAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcihuYW1lLCB2YWx1ZSlcbiAgICAgIH0pXG5cbiAgICAgIHhoci5zZW5kKHR5cGVvZiByZXF1ZXN0Ll9ib2R5SW5pdCA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogcmVxdWVzdC5fYm9keUluaXQpXG4gICAgfSlcbiAgfVxuICBzZWxmLmZldGNoLnBvbHlmaWxsID0gdHJ1ZVxufSkodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnID8gc2VsZiA6IHRoaXMpO1xuIiwiY29uc3Qgc3RvcmUgPSAnZGFyd2luLXN0cmVldC1mb29kJztcbmNvbnN0IHZlcnNpb24gPSAxO1xuY29uc3QgdmVuZG9yU3RvcmVOYW1lID0gJ3ZlbmRvcnMnO1xuXG5jbGFzcyBEQkhhbmRsZXIge1xuXHRjb25zdHJ1Y3RvcigpIHtcblxuXHRcdHRoaXMucGVuZGluZ0FjdGlvbnMgPSBbXTtcblx0XHR0aGlzLmNvbm5lY3QoKTtcblxuXHRcdHRoaXMuc2F2ZURhdGEgPSB0aGlzLnNhdmVEYXRhLmJpbmQodGhpcyk7XG5cdFx0dGhpcy5nZXRBbGxEYXRhID0gdGhpcy5nZXRBbGxEYXRhLmJpbmQodGhpcyk7XG5cdFx0dGhpcy5fZ2V0QWxsRGF0YUZvclByb21pc2UgPSB0aGlzLl9nZXRBbGxEYXRhRm9yUHJvbWlzZS5iaW5kKHRoaXMpO1xuXHR9XG5cblx0ZXJyb3JIYW5kbGVyKGV2dCkge1xuXHRcdGNvbnNvbGUuZXJyb3IoJ0RCIEVycm9yJywgZXZ0LnRhcmdldC5lcnJvcik7XG5cdH1cblxuXHR1cGdyYWRlREIoZXZ0KSB7XG5cdFx0Y29uc3QgZGIgPSBldnQudGFyZ2V0LnJlc3VsdDtcblxuXHRcdGlmKGV2dC5vbGRWZXJzaW9uIDwgMSkge1xuXHRcdFx0Y29uc3QgdmVuZG9yU3RvcmUgPSBkYi5jcmVhdGVPYmplY3RTdG9yZSh2ZW5kb3JTdG9yZU5hbWUsIHtrZXlQYXRoOiAnaWQnfSk7XG5cdFx0XHR2ZW5kb3JTdG9yZS5jcmVhdGVJbmRleCgnbmFtZScsICduYW1lJywge3VuaXF1ZTogdHJ1ZX0pO1xuXHRcdH1cblx0fVxuXG5cdGNvbm5lY3QoKSB7XG5cdFx0Y29uc3QgY29ublJlcXVlc3QgPSBpbmRleGVkREIub3BlbihzdG9yZSwgdmVyc2lvbik7XG5cblx0XHRjb25uUmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdzdWNjZXNzJywgKGV2dCkgPT4ge1xuXHRcdFx0dGhpcy5kYiA9IGV2dC50YXJnZXQucmVzdWx0O1xuXHRcdFx0dGhpcy5kYi5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHRoaXMuZXJyb3JIYW5kbGVyKTtcblxuXHRcdFx0aWYodGhpcy5wZW5kaW5nQWN0aW9ucykge1xuXHRcdFx0XHR3aGlsZSh0aGlzLnBlbmRpbmdBY3Rpb25zLmxlbmd0aCA8IDApIHtcblx0XHRcdFx0XHR0aGlzLnBlbmRpbmdBY3Rpb25zLnBvcCgpKCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9KTtcblxuXHRcdGNvbm5SZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ3VwZ3JhZGVuZWVkZWQnLCB0aGlzLnVwZ3JhZGVEQik7XG5cblx0XHRjb25uUmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHRoaXMuZXJyb3JIYW5kbGVyKTtcblx0fVxuXG5cdHNhdmVEYXRhKGRhdGEpIHtcblx0XHRpZighdGhpcy5kYikge1xuXHRcdFx0dGhpcy5wZW5kaW5nQWN0aW9ucy5wdXNoKCgpID0+IHRoaXMuc2F2ZURhdGEoZGF0YSkpO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdGNvbnN0IGRhdGFBcnIgPSBBcnJheS5pc0FycmF5KGRhdGEpXG5cdFx0XHQ/IGRhdGFcblx0XHRcdDogW2RhdGFdO1xuXG5cdFx0Y29uc3QgdHJhbnNhY3Rpb24gPSB0aGlzLmRiLnRyYW5zYWN0aW9uKHZlbmRvclN0b3JlTmFtZSwgJ3JlYWR3cml0ZScpO1xuXHRcdHZhciB2ZW5kb3JTdG9yZSA9IHRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKHZlbmRvclN0b3JlTmFtZSk7XG5cblx0XHRkYXRhQXJyLmZvckVhY2goKHZlbmRvckRhdGEpID0+IHZlbmRvclN0b3JlXG5cdFx0XHQuZ2V0KHZlbmRvckRhdGEuaWQpXG5cdFx0XHQub25zdWNjZXNzID0gKGV2dCkgPT4ge1xuXHRcdFx0XHRpZihldnQudGFyZ2V0LnJlc3VsdCkge1xuXHRcdFx0XHRcdGlmKEpTT04uc3RyaW5naWZ5KGV2dC50YXJnZXQucmVzdWx0KSAhPT0gSlNPTi5zdHJpbmdpZnkodmVuZG9yRGF0YSkpIHtcblx0XHRcdFx0XHRcdHZlbmRvclN0b3JlLnB1dCh2ZW5kb3JEYXRhKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0dmVuZG9yU3RvcmUuYWRkKHZlbmRvckRhdGEpO1xuXHRcdFx0XHR9XG5cdFx0XHR9KTtcblxuXHR9XG5cblx0X2dldEFsbERhdGFGb3JQcm9taXNlKHJlc29sdmUsIHJlamVjdCkge1xuXHRcdGlmKCF0aGlzLmRiKSB7XG5cdFx0XHR0aGlzLnBlbmRpbmdBY3Rpb25zLnB1c2goKCkgPT4gdGhpcy5fZ2V0QWxsRGF0YUZvclByb21pc2UocmVzb2x2ZSwgcmVqZWN0KSk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGNvbnN0IHZlbmRvckRhdGEgPSBbXTtcblx0XHRjb25zdCB2ZW5kb3JTdG9yZSA9IHRoaXMuZGIudHJhbnNhY3Rpb24odmVuZG9yU3RvcmVOYW1lKS5vYmplY3RTdG9yZSh2ZW5kb3JTdG9yZU5hbWUpO1xuXHRcdGNvbnN0IGN1cnNvciA9IHZlbmRvclN0b3JlLm9wZW5DdXJzb3IoKTtcblx0XHRcblx0XHRjdXJzb3Iub25zdWNjZXNzID0gKGV2dCkgPT4ge1xuXHRcdFx0Y29uc3QgY3Vyc29yID0gZXZ0LnRhcmdldC5yZXN1bHQ7XG5cdFx0XHRpZihjdXJzb3IpIHtcblx0XHRcdFx0dmVuZG9yRGF0YS5wdXNoKGN1cnNvci52YWx1ZSk7XG5cdFx0XHRcdHJldHVybiBjdXJzb3IuY29udGludWUoKTtcblx0XHRcdH1cblx0XHRcdHJlc29sdmUodmVuZG9yRGF0YSk7XG5cdFx0fTtcblxuXHRcdGN1cnNvci5vbmVycm9yID0gKGV2dCkgPT4gcmVqZWN0KGV2dC50YXJnZXQuZXJyb3IpO1xuXHR9XG5cblx0Z2V0QWxsRGF0YSgpIHtcblx0XHRyZXR1cm4gbmV3IFByb21pc2UodGhpcy5fZ2V0QWxsRGF0YUZvclByb21pc2UpO1xuXHR9XG5cblxufVxuXG5leHBvcnQgZGVmYXVsdCBEQkhhbmRsZXI7XG4iLCJpbXBvcnQgZWpzIGZyb20gJ2Vqcyc7XG5pbXBvcnQgdGltZUNvbnZlcnQgZnJvbSAnLi90aW1lLWNvbnZlcnQnO1xuXG5jb25zdCBkYXlzID0gWydTdW5kYXknLCAnTW9uZGF5JywgJ1R1ZXNkYXknLCAnV2VkbmVzZGF5JywgJ1RodXJzZGF5JywgJ0ZyaWRheScsICdTYXR1cmRheSddO1xubGV0IHRlbXBsYXRlU3RyaW5nID0gdW5kZWZpbmVkO1xubGV0IHRlbXBsYXRlID0gdW5kZWZpbmVkO1xubGV0IHRhcmdldCA9IHVuZGVmaW5lZDtcbmxldCBkYXRhID0gdW5kZWZpbmVkO1xuXG5jb25zdCBzZXREYXRhID0gKGRheURhdGEpID0+IGRhdGEgPSBkYXlEYXRhO1xuY29uc3QgZ2V0RGF0YSA9ICgpID0+IGRhdGE7XG5cbmNvbnN0IGdldFRhcmdldCA9ICgpID0+IHtcblx0aWYoIXRhcmdldCkge1xuXHRcdHRhcmdldCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy5kYXlfX2NvbnRhaW5lcicpO1xuXHR9XG5cdHJldHVybiB0YXJnZXQ7XG59O1xuXG5jb25zdCByZW5kZXJEYXkgPSAoZGF0YSkgPT4ge1xuXHRpZighdGVtcGxhdGUpIHtcblx0XHR0ZW1wbGF0ZVN0cmluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXlUZW1wbGF0ZScpLmlubmVySFRNTDtcblx0XHR0ZW1wbGF0ZSA9IGVqcy5jb21waWxlKHRlbXBsYXRlU3RyaW5nKTtcblx0fVxuXG5cdGNvbnN0IGh0bWwgPSB0ZW1wbGF0ZShkYXRhKTtcblx0Y29uc3QgdGVtcGxhdGVFbGVtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKTtcblx0dGVtcGxhdGVFbGVtLmlubmVySFRNTCA9IGh0bWwudHJpbSgpO1xuXHRyZXR1cm4gdGVtcGxhdGVFbGVtLmNvbnRlbnQuZmlyc3RDaGlsZDtcbn07XG5cbmZ1bmN0aW9uIGRyYXdEYXkoZGF5LCB2ZW5kb3JzLCBjbGFzc2VzKSB7XG5cdHZhciBvcGVuID0gW107XG5cblx0dmVuZG9ycy5mb3JFYWNoKCh2ZW5kb3IpID0+IHtcblx0XHR2YXIgb3BlbkluZGV4ID0gdmVuZG9yLmxvY2F0aW9ucy5maW5kSW5kZXgoXG5cdFx0XHQobG9jYXRpb24pID0+IGxvY2F0aW9uLmRheXNbZGF5XS5vcGVuXG5cdFx0KTtcblxuXHRcdGlmKG9wZW5JbmRleCA+PSAwKSB7XG5cdFx0XHR2YXIgb3BlbkxvY2F0aW9uID0gdmVuZG9yLmxvY2F0aW9uc1tvcGVuSW5kZXhdO1xuXHRcdFx0dmFyIG9wZW5EYXkgPSBvcGVuTG9jYXRpb24uZGF5c1tkYXldO1xuXG5cdFx0XHRvcGVuLnB1c2goT2JqZWN0LmFzc2lnbihcblx0XHRcdFx0e30sXG5cdFx0XHRcdHZlbmRvcixcblx0XHRcdFx0e1xuXHRcdFx0XHRcdG9wZW5Mb2NhdGlvbixcblx0XHRcdFx0XHRvcGVuRGF5OiB7XG5cdFx0XHRcdFx0XHRkYXksXG5cdFx0XHRcdFx0XHRzdGFydDogdGltZUNvbnZlcnQob3BlbkRheS5zdGFydCksXG5cdFx0XHRcdFx0XHRlbmQ6IHRpbWVDb252ZXJ0KG9wZW5EYXkuZW5kKVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0KSk7XG5cdFx0fVxuXG5cdH0pO1xuXG5cdGNvbnN0IGNvbnRlbnQgPSByZW5kZXJEYXkoe1xuXHRcdGRheTogZGF5c1tkYXldLFxuXHRcdGRheUluZGV4OiBkYXksXG5cdFx0dmVuZG9yczogb3BlblxuXHR9KTtcblxuXHRjb25zdCBuZXh0ID0gY29udGVudC5xdWVyeVNlbGVjdG9yKCcuZGF5X19uZXh0LWJ0bicpO1xuXHRuZXh0LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgbmV4dERheSk7XG5cdGNvbnN0IHByZXYgPSBjb250ZW50LnF1ZXJ5U2VsZWN0b3IoJy5kYXlfX3ByZXYtYnRuJyk7XG5cdHByZXYuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBwcmV2RGF5KTtcblxuXHRpZihjbGFzc2VzKSB7XG5cdFx0Y29uc3QgY2xhc3NBcnIgPSBBcnJheS5pc0FycmF5KGNsYXNzZXMpID8gY2xhc3NlcyA6IFtjbGFzc2VzXTtcblx0XHRjbGFzc0Fyci5mb3JFYWNoKChjbGFzc05hbWUpID0+IHtcblx0XHRcdGNvbnRlbnQuY2xhc3NMaXN0LmFkZChjbGFzc05hbWUpO1xuXHRcdH0pO1xuXHR9XG5cblx0cmV0dXJuIGNvbnRlbnQ7XG59XG5cbmZ1bmN0aW9uIGRyYXdEYXlzKGRheURhdGEpIHtcblx0c2V0RGF0YShkYXlEYXRhKTtcblx0Z2V0VGFyZ2V0KCkuaW5uZXJIVE1MID0gbnVsbDtcblxuXHR2YXIgbm93ID0gbmV3IERhdGUoKTtcblx0dmFyIHRvZGF5ID0gbm93LmdldERheSgpO1xuXHR2YXIgeWVzdGVyZGF5ID0gdG9kYXkgPiAwID8gdG9kYXkgLSAxIDogNjtcblx0dmFyIHRvbW9ycm93ID0gdG9kYXkgPCA2ID8gdG9kYXkgKyAxIDogMDtcblxuXHRnZXRUYXJnZXQoKS5hcHBlbmRDaGlsZChcblx0XHRkcmF3RGF5KHllc3RlcmRheSwgZGF5RGF0YSlcblx0KTtcblx0Z2V0VGFyZ2V0KCkuYXBwZW5kQ2hpbGQoXG5cdFx0ZHJhd0RheSh0b2RheSwgZGF5RGF0YSlcblx0KVxuXHRnZXRUYXJnZXQoKS5hcHBlbmRDaGlsZChcblx0XHRkcmF3RGF5KHRvbW9ycm93LCBkYXlEYXRhKVxuXHQpO1xuXG5cbn1cblxuZnVuY3Rpb24gbmV4dERheSgpIHtcblx0Y29uc3QgdGFyZ2V0ID0gZ2V0VGFyZ2V0KCk7XG5cdGNvbnN0IGRheXMgPSB0YXJnZXQuY2hpbGROb2Rlcztcblx0Y29uc3QgbGFzdERheSA9IGRheXNbZGF5cy5sZW5ndGggLSAxXTtcblx0Y29uc3QgZGF5SW5kZXggPSBwYXJzZUludChsYXN0RGF5LmRhdGFzZXQuZGF5KTtcblx0Y29uc3QgbmV4dERheSA9IGRheUluZGV4IDwgNiA/IGRheUluZGV4ICsgMSA6IDA7XG5cdGNvbnN0IGRheSA9IGRyYXdEYXkobmV4dERheSwgZ2V0RGF0YSgpKTtcblx0Y29uc3QgbGlzdGVuID0gKGV2dCkgPT4ge1xuXHRcdHRhcmdldC5jbGFzc0xpc3QucmVtb3ZlKCdkYXktLW5leHQnKTtcblx0XHR0YXJnZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcigndHJhbnNpdGlvbmVuZCcsIGxpc3Rlbik7XG5cdFx0dGFyZ2V0LnJlbW92ZUNoaWxkKGRheXNbMF0pO1xuXHRcdHRhcmdldC5hcHBlbmRDaGlsZChkYXkpO1xuXHR9O1xuXHRcblx0dGFyZ2V0LmFkZEV2ZW50TGlzdGVuZXIoJ3RyYW5zaXRpb25lbmQnLCBsaXN0ZW4pO1xuXHR0YXJnZXQuY2xhc3NMaXN0LmFkZCgnZGF5LS1uZXh0Jyk7XG59XG5cbmZ1bmN0aW9uIHByZXZEYXkoKSB7XG5cdGNvbnN0IHRhcmdldCA9IGdldFRhcmdldCgpO1xuXHRjb25zdCBkYXlzID0gdGFyZ2V0LmNoaWxkTm9kZXM7XG5cdGNvbnN0IGZpcnN0RGF5ID0gZGF5c1swXTtcblx0Y29uc3QgZGF5SW5kZXggPSBwYXJzZUludChmaXJzdERheS5kYXRhc2V0LmRheSk7XG5cdGNvbnN0IG5leHREYXkgPSBkYXlJbmRleCA+IDAgPyBkYXlJbmRleCAtIDEgOiA2O1xuXHRjb25zdCBkYXkgPSBkcmF3RGF5KG5leHREYXksIGdldERhdGEoKSk7XG5cdGNvbnN0IGxpc3RlbiA9ICgpID0+IHtcblx0XHR0YXJnZXQuY2xhc3NMaXN0LnJlbW92ZSgnZGF5LS1wcmV2aW91cycpO1xuXHRcdHRhcmdldC5yZW1vdmVFdmVudExpc3RlbmVyKCd0cmFuc2l0aW9uZW5kJywgbGlzdGVuKTtcblx0XHR0YXJnZXQucmVtb3ZlQ2hpbGQoZGF5c1tkYXlzLmxlbmd0aCAtIDFdKTtcblx0XHR0YXJnZXQucHJlcGVuZChkYXkpO1xuXHR9O1xuXHRcblx0dGFyZ2V0LmFkZEV2ZW50TGlzdGVuZXIoJ3RyYW5zaXRpb25lbmQnLCBsaXN0ZW4pO1xuXHR0YXJnZXQuY2xhc3NMaXN0LmFkZCgnZGF5LS1wcmV2aW91cycpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBkcmF3RGF5cztcbiIsIlxuY29uc3QgdXJsID0gJ2RhdGEuanNvbic7XG5cbmZ1bmN0aW9uIGxvYWRMaXN0KCkge1xuXHRyZXR1cm4gZmV0Y2godXJsKVxuXHRcdC50aGVuKChyZXNwb25zZSkgPT4gcmVzcG9uc2UuanNvbigpKVxuXHRcdC50aGVuKChkYXRhKSA9PiBkYXRhLmZlYXR1cmVzXG5cdFx0XHRcdD8gZGF0YS5mZWF0dXJlcy5tYXAoKGZlYXR1cmUpID0+IGZlYXR1cmUucHJvcGVydGllcylcblx0XHRcdFx0OiB1bmRlZmluZWRcblx0XHQpO1xuXG59O1xuXG5leHBvcnQgZGVmYXVsdCBsb2FkTGlzdDtcbiIsImltcG9ydCAnd2hhdHdnLWZldGNoJztcbmltcG9ydCBsb2FkTGlzdCBmcm9tICcuL2xvYWQtbGlzdCc7XG5pbXBvcnQgdGlkeUxpc3QgZnJvbSAnLi90aWR5LWxpc3QnO1xuaW1wb3J0IGRyYXdEYXlzIGZyb20gJy4vZHJhdy1kYXlzJztcbmltcG9ydCBEQkhhbmRsZXIgZnJvbSAnLi9kYi1oYW5kbGVyJztcblxuY29uc3QgZGJIYW5kbGVyID0gbmV3IERCSGFuZGxlcigpO1xuXG5kYkhhbmRsZXIuZ2V0QWxsRGF0YSgpXG5cdC50aGVuKGRyYXdEYXlzKTtcblxuY29uc3QgZmV0Y2hWZW5kb3JzID0gbG9hZExpc3QoKVxuXHQudGhlbih0aWR5TGlzdCk7XG5cbmZldGNoVmVuZG9ycy50aGVuKGRyYXdEYXlzKTtcbmZldGNoVmVuZG9ycy50aGVuKGRiSGFuZGxlci5zYXZlRGF0YSk7XG5cbmlmICgnc2VydmljZVdvcmtlcicgaW4gbmF2aWdhdG9yKSB7XG5cdHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgKCkgPT4gbmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIucmVnaXN0ZXIoJ3N3LmpzJylcblx0XHQuY2F0Y2goKGVycikgPT4gY29uc29sZS5lcnJvcignU2VydmljZVdvcmtlciByZWdpc3RyYXRpb24gZmFpbGVkOiAnLCBlcnIpKVxuXHQpO1xufVxuIiwiXG5jb25zdCBkYXlzID0ge1xuXHQnU3VuZGF5JzogJ1N1bicsXG5cdCdNb25kYXknOiAnTW9uJyxcblx0J1R1ZXNkYXknOiAnVHVlcycsXG5cdCdXZWRuZXNkYXknOiAnV2VkJyxcblx0J1RodXJzZGF5JzogJ1RodXJzJyxcblx0J0ZyaWRheSc6ICdGcmknLFxuXHQnU2F0dXJkYXknOiAnU2F0J1xufTtcblxuXG5mdW5jdGlvbiB0aWR5TGlzdChsaXN0RGF0YSkge1xuXHRyZXR1cm4gbGlzdERhdGEuZmlsdGVyKChyZWNvcmQsIGluZGV4KSA9PiBsaXN0RGF0YS5maW5kSW5kZXgoKGZpbmRSZWNvcmQpID0+IGZpbmRSZWNvcmQuTmFtZSA9PT0gcmVjb3JkLk5hbWUpID09PSBpbmRleClcblx0XHQubWFwKChyZWNvcmQpID0+ICh7XG5cdFx0XHRpZDogcmVjb3JkLk9CSkVDVElELFxuXHRcdFx0bmFtZTogcmVjb3JkLk5hbWUsXG5cdFx0XHR3ZWJzaXRlOiByZWNvcmQuV2Vic2l0ZSxcblx0XHRcdHR5cGU6IHJlY29yZC5UeXBlLFxuXHRcdFx0bG9jYXRpb25zOiBsaXN0RGF0YS5maWx0ZXIoKGxvY2F0aW9uUmVjb3JkKSA9PiBsb2NhdGlvblJlY29yZC5OYW1lID09PSByZWNvcmQuTmFtZSlcblx0XHRcdFx0Lm1hcCgobG9jYXRpb25SZWNvcmQpID0+ICh7XG5cdFx0XHRcdFx0bmFtZTogbG9jYXRpb25SZWNvcmQuTG9jYXRpb24sXG5cdFx0XHRcdFx0b3BlblRpbWVzOiBsb2NhdGlvblJlY29yZC5PcGVuX1RpbWVzX0Rlc2NyaXB0aW9uLFxuXHRcdFx0XHRcdGRheXM6IE9iamVjdC5rZXlzKGRheXMpXG5cdFx0XHRcdFx0XHQubWFwKChkYXkpID0+ICh7XG5cdFx0XHRcdFx0XHRcdGRheSxcblx0XHRcdFx0XHRcdFx0b3BlbjogcmVjb3JkW2RheV0gPT09ICdZZXMnLFxuXHRcdFx0XHRcdFx0XHRzdGFydDogcmVjb3JkW2Ake2RheXNbZGF5XX1fU3RhcnRgXSxcblx0XHRcdFx0XHRcdFx0ZW5kOiByZWNvcmRbYCR7ZGF5c1tkYXldfV9FbmRgXVxuXHRcdFx0XHRcdFx0fSkpXG5cdFx0XHRcdH0pKVxuXHRcdH0pKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgdGlkeUxpc3Q7XG4iLCJcbi8qKlxuKiBDb252ZXJ0IGEgMjQgaG91ciB0aW1lIHRvIDEyIGhvdXJcbiogZnJvbSBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8xMzg5ODQyMy9qYXZhc2NyaXB0LWNvbnZlcnQtMjQtaG91ci10aW1lLW9mLWRheS1zdHJpbmctdG8tMTItaG91ci10aW1lLXdpdGgtYW0tcG0tYW5kLW5vXG4qIEBwYXJhbSB7c3RyaW5nfSB0aW1lIEEgMjQgaG91ciB0aW1lIHN0cmluZ1xuKiBAcmV0dXJuIHtzdHJpbmd9IEEgZm9ybWF0dGVkIDEyIGhvdXIgdGltZSBzdHJpbmdcbioqL1xuZnVuY3Rpb24gdENvbnZlcnQgKHRpbWUpIHtcblx0Ly8gQ2hlY2sgY29ycmVjdCB0aW1lIGZvcm1hdCBhbmQgc3BsaXQgaW50byBjb21wb25lbnRzXG5cdHRpbWUgPSB0aW1lLnRvU3RyaW5nICgpLm1hdGNoICgvXihbMDFdXFxkfDJbMC0zXSkoWzAtNV1cXGQpJC8pIHx8IFt0aW1lXTtcblxuXHRpZiAodGltZS5sZW5ndGggPiAxKSB7IC8vIElmIHRpbWUgZm9ybWF0IGNvcnJlY3Rcblx0XHRjb25zdCBzdWZmaXggPSB0aW1lWzFdIDwgMTIgPyAnQU0nIDogJ1BNJzsgLy8gU2V0IEFNL1BNXG5cdFx0Y29uc3QgaG91cnMgPSB0aW1lWzFdICUgMTIgfHwgMTI7IC8vIEFkanVzdCBob3Vyc1xuXHRcdGNvbnN0IG1pbnV0ZXMgPSB0aW1lWzJdO1xuXG5cdFx0cmV0dXJuIGAke2hvdXJzfToke21pbnV0ZXN9JHtzdWZmaXh9YDtcblx0fVxuXHRyZXR1cm4gdGltZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgdENvbnZlcnQ7XG4iXX0=
