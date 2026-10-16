'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

// Require this before any module under src/. src/config and src/message
// read and write under ~/.teleirc, and message.js saves messages.json every
// 30 s. HOME points at a temporary directory, so a test run never touches
// a real bot's files (on the production host it would overwrite
// messages.json). Node caches this module, so all specs share one HOME.
var home = fs.mkdtempSync(path.join(os.tmpdir(), 'teleirc-test-'));
fs.mkdirSync(path.join(home, '.teleirc'));
fs.copyFileSync(path.join(__dirname, '..', '..', 'src', 'config.defaults.js'),
                path.join(home, '.teleirc', 'config.js'));
process.env.HOME = home;

// src/arguments.js parses process.argv in strict mode and stops on mocha's
// own flags (such as --exit), so hide them.
process.argv = process.argv.slice(0, 2);

after(function() {
    fs.rmSync(home, {recursive: true, force: true});
});

module.exports = home;
