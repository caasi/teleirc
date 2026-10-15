'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

// src/irc/util requires src/config and src/message. Both read and write
// under ~/.teleirc, and message.js saves messages.json every 30 s. Point
// HOME at a temporary directory so a test run never touches a real bot's
// files (on the production host it would overwrite messages.json).
var home = fs.mkdtempSync(path.join(os.tmpdir(), 'teleirc-test-'));
fs.mkdirSync(path.join(home, '.teleirc'));
fs.copyFileSync(path.join(__dirname, '..', 'src', 'config.defaults.js'),
                path.join(home, '.teleirc', 'config.js'));
process.env.HOME = home;

// src/arguments.js parses process.argv in strict mode and stops on mocha's
// own flags (such as --exit), so hide them before the require.
process.argv = process.argv.slice(0, 2);

var ircUtil = require('../src/irc/util');

// Each case is [input, expected]. The expected values are what parseUrl
// returned when these tests were written. The inputs come from a manual
// check script kept on the production host since 2018.
var cases = require('./parse-url-cases.json');

describe('irc/util parseUrl', function() {
    after(function() {
        fs.rmSync(home, {recursive: true, force: true});
    });

    cases.forEach(function(c) {
        it('simplifies ' + c[1].type + ': ' + c[1].url, function() {
            assert.deepStrictEqual(ircUtil.parseUrl(c[0]), c[1]);
        });
    });
});
